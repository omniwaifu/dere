package taskqueue

import (
	"fmt"
	"log"
	"time"

	"dere/src/database"
	"dere/src/embeddings"
)

// Processor handles task execution
type Processor struct {
	queue       *Queue
	db          *database.TursoDB
	ollama      *embeddings.OllamaClient
	maxRetries  int
	currentModel string
}

// NewProcessor creates a new task processor
func NewProcessor(queue *Queue, db *database.TursoDB, ollama *embeddings.OllamaClient) *Processor {
	return &Processor{
		queue:      queue,
		db:         db,
		ollama:     ollama,
		maxRetries: 3,
	}
}

// ProcessTasks processes tasks in batches by model to minimize switching
func (p *Processor) ProcessTasks() error {
	tasksByModel, err := p.queue.GetTasksByModel()
	if err != nil {
		return fmt.Errorf("failed to get tasks by model: %w", err)
	}

	if len(tasksByModel) == 0 {
		return nil // No tasks to process
	}

	// Process models in order of priority/task count
	for modelName, tasks := range tasksByModel {
		if len(tasks) == 0 {
			continue
		}

		log.Printf("Processing %d tasks for model %s", len(tasks), modelName)

		// Switch model if needed
		if p.currentModel != modelName {
			log.Printf("Switching to model: %s", modelName)
			p.currentModel = modelName
			// Add small delay to let model switch settle
			time.Sleep(500 * time.Millisecond)
		}

		// Process all tasks for this model
		for _, task := range tasks {
			if err := p.processTask(task); err != nil {
				log.Printf("Failed to process task %d: %v", task.ID, err)
			}
		}
	}

	return nil
}

// processTask processes a single task
func (p *Processor) processTask(task *Task) error {
	// Mark as processing
	if err := p.queue.UpdateStatus(task.ID, TaskStatusProcessing, nil); err != nil {
		return fmt.Errorf("failed to mark task as processing: %w", err)
	}

	var result *TaskResult
	var err error

	switch task.TaskType {
	case TaskTypeEmbedding:
		result, err = p.processEmbeddingTask(task)
	case TaskTypeSummarization:
		result, err = p.processSummarizationTask(task)
	default:
		err = fmt.Errorf("unknown task type: %s", task.TaskType)
	}

	if err != nil {
		return p.handleTaskError(task, err)
	}

	if result.Success {
		return p.handleTaskSuccess(task, result)
	} else {
		return p.handleTaskError(task, fmt.Errorf(result.Error))
	}
}

// processEmbeddingTask processes an embedding task
func (p *Processor) processEmbeddingTask(task *Task) (*TaskResult, error) {
	start := time.Now()

	var metadata EmbeddingMetadata
	if err := task.GetMetadata(&metadata); err != nil {
		return nil, fmt.Errorf("failed to get embedding metadata: %w", err)
	}

	// Generate embedding
	embedding, err := p.ollama.GetEmbedding(task.Content)
	if err != nil {
		return &TaskResult{
			TaskID:   task.ID,
			Success:  false,
			Error:    err.Error(),
			Duration: time.Since(start),
		}, nil
	}

	result := &EmbeddingResult{
		Embedding:      embedding,
		ProcessedText:  task.Content,
		ProcessingMode: metadata.ProcessingMode,
	}

	// Store embedding in database if this is for a conversation
	if metadata.ConversationID != nil {
		// Update the conversation with the embedding
		// This would need a new method in the database package
		log.Printf("Would update conversation %d with embedding", *metadata.ConversationID)
	}

	return &TaskResult{
		TaskID:   task.ID,
		Success:  true,
		Result:   result,
		Duration: time.Since(start),
	}, nil
}

// processSummarizationTask processes a summarization task
func (p *Processor) processSummarizationTask(task *Task) (*TaskResult, error) {
	start := time.Now()

	var metadata SummarizationMetadata
	if err := task.GetMetadata(&metadata); err != nil {
		return nil, fmt.Errorf("failed to get summarization metadata: %w", err)
	}

	// This would call the summarization logic similar to what's in the hook
	// For now, just return a placeholder
	log.Printf("Would summarize content of length %d using mode %s", metadata.OriginalLength, metadata.Mode)

	return &TaskResult{
		TaskID:   task.ID,
		Success:  true,
		Result:   "Summarization result placeholder",
		Duration: time.Since(start),
	}, nil
}

// handleTaskSuccess handles successful task completion
func (p *Processor) handleTaskSuccess(task *Task, result *TaskResult) error {
	log.Printf("Task %d completed successfully in %v", task.ID, result.Duration)

	if err := p.queue.UpdateStatus(task.ID, TaskStatusCompleted, nil); err != nil {
		return fmt.Errorf("failed to mark task as completed: %w", err)
	}

	return nil
}

// handleTaskError handles task errors with retry logic
func (p *Processor) handleTaskError(task *Task, err error) error {
	log.Printf("Task %d failed: %v (retry %d/%d)", task.ID, err, task.RetryCount+1, p.maxRetries)

	if task.RetryCount < p.maxRetries {
		// Increment retry count and reset to pending
		if retryErr := p.queue.IncrementRetry(task.ID); retryErr != nil {
			log.Printf("Failed to increment retry count: %v", retryErr)
		}

		if statusErr := p.queue.UpdateStatus(task.ID, TaskStatusPending, nil); statusErr != nil {
			log.Printf("Failed to reset task to pending: %v", statusErr)
		}

		return nil // Don't return error, task will be retried
	}

	// Max retries exceeded, mark as failed
	errorMsg := err.Error()
	if statusErr := p.queue.UpdateStatus(task.ID, TaskStatusFailed, &errorMsg); statusErr != nil {
		return fmt.Errorf("failed to mark task as failed: %w", statusErr)
	}

	return nil
}

// GetOptimalBatchSize returns the optimal batch size for a model
func (p *Processor) GetOptimalBatchSize(modelName string) int {
	switch modelName {
	case "mxbai-embed-large":
		return 10 // Embeddings are relatively fast
	case "gemma3n:latest":
		return 3 // Summarization is slower
	default:
		return 5 // Default batch size
	}
}

// ProcessBatch processes a specific batch of tasks for a model
func (p *Processor) ProcessBatch(modelName string, batchSize int) error {
	tasks, err := p.queue.GetPendingTasks(modelName, batchSize)
	if err != nil {
		return fmt.Errorf("failed to get pending tasks: %w", err)
	}

	if len(tasks) == 0 {
		return nil
	}

	log.Printf("Processing batch of %d tasks for model %s", len(tasks), modelName)

	// Switch model if needed
	if p.currentModel != modelName {
		log.Printf("Switching to model: %s", modelName)
		p.currentModel = modelName
		time.Sleep(500 * time.Millisecond)
	}

	// Process each task in the batch
	for _, task := range tasks {
		if err := p.processTask(task); err != nil {
			log.Printf("Failed to process task %d: %v", task.ID, err)
		}
	}

	return nil
}