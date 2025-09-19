package taskqueue

import (
	"encoding/json"
	"fmt"
	"log"
	"strings"
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
	case TaskTypeEntityExtraction:
		result, err = p.processEntityExtractionTask(task)
	case TaskTypeEntityRelationship:
		result, err = p.processEntityRelationshipTask(task)
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

// processEntityExtractionTask processes an entity extraction task using LLM
func (p *Processor) processEntityExtractionTask(task *Task) (*TaskResult, error) {
	start := time.Now()

	var metadata EntityExtractionMetadata
	if err := task.GetMetadata(&metadata); err != nil {
		return nil, fmt.Errorf("failed to get entity extraction metadata: %w", err)
	}

	// Create structured prompt for entity extraction
	prompt := p.buildEntityExtractionPrompt(task.Content, metadata)

	// Use LLM for entity extraction with the task's model
	entities, err := p.extractEntitiesWithLLM(prompt, task.ModelName, metadata)
	if err != nil {
		return &TaskResult{
			TaskID:   task.ID,
			Success:  false,
			Error:    fmt.Sprintf("LLM entity extraction failed: %v", err),
			Duration: time.Since(start),
		}, nil
	}

	// Store entities in database
	if err := p.storeEntities(entities, task, metadata); err != nil {
		return &TaskResult{
			TaskID:   task.ID,
			Success:  false,
			Error:    fmt.Sprintf("Failed to store entities: %v", err),
			Duration: time.Since(start),
		}, nil
	}

	result := &EntityExtractionResult{
		Entities:       entities,
		TotalExtracted: len(entities),
		ProcessingMode: "llm_semantic",
	}

	log.Printf("Extracted %d entities from task %d", len(entities), task.ID)

	return &TaskResult{
		TaskID:   task.ID,
		Success:  true,
		Result:   result,
		Duration: time.Since(start),
	}, nil
}

// processEntityRelationshipTask processes relationship inference between entities
func (p *Processor) processEntityRelationshipTask(task *Task) (*TaskResult, error) {
	start := time.Now()

	var metadata EntityRelationshipMetadata
	if err := task.GetMetadata(&metadata); err != nil {
		return nil, fmt.Errorf("failed to get relationship metadata: %w", err)
	}

	// Get entities from database
	entities, err := p.getEntitiesForRelationship(metadata.EntityIDs)
	if err != nil {
		return &TaskResult{
			TaskID:   task.ID,
			Success:  false,
			Error:    fmt.Sprintf("Failed to get entities: %v", err),
			Duration: time.Since(start),
		}, nil
	}

	// Use LLM to infer relationships
	relationships, err := p.inferRelationshipsWithLLM(entities, task.Content, metadata)
	if err != nil {
		return &TaskResult{
			TaskID:   task.ID,
			Success:  false,
			Error:    fmt.Sprintf("LLM relationship inference failed: %v", err),
			Duration: time.Since(start),
		}, nil
	}

	// Store relationships in database
	if err := p.storeRelationships(relationships); err != nil {
		return &TaskResult{
			TaskID:   task.ID,
			Success:  false,
			Error:    fmt.Sprintf("Failed to store relationships: %v", err),
			Duration: time.Since(start),
		}, nil
	}

	result := &EntityRelationshipResult{
		Relationships: relationships,
		TotalInferred: len(relationships),
	}

	log.Printf("Inferred %d relationships from task %d", len(relationships), task.ID)

	return &TaskResult{
		TaskID:   task.ID,
		Success:  true,
		Result:   result,
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

// buildEntityExtractionPrompt creates a structured prompt for LLM entity extraction
func (p *Processor) buildEntityExtractionPrompt(content string, metadata EntityExtractionMetadata) string {
	contextPrompt := ""
	switch metadata.ContextHint {
	case "coding":
		contextPrompt = "This is a software development conversation. Focus on extracting code entities like functions, files, libraries, and technical concepts."
	case "general":
		contextPrompt = "This is a general conversation. Focus on extracting people, places, organizations, and topics."
	case "project":
		contextPrompt = "This is a project discussion. Focus on extracting project names, team members, technologies, and deliverables."
	default:
		contextPrompt = "Extract meaningful entities from this text."
	}

	return fmt.Sprintf(`%s

Extract key entities from this text. Return JSON with entities array.

Format:
{"entities": [{"type": "technology", "value": "React", "confidence": 0.9}]}

Text: %s

JSON:`, contextPrompt, content)
}

// extractEntitiesWithLLM uses LLM to extract entities from text
func (p *Processor) extractEntitiesWithLLM(prompt, modelName string, metadata EntityExtractionMetadata) ([]Entity, error) {
	log.Printf("Calling %s with prompt length: %d chars", modelName, len(prompt))

	// Call Ollama to generate entity extraction using the specified model
	response, err := p.ollama.GenerateWithModel(prompt, modelName)
	if err != nil {
		log.Printf("LLM call failed for model %s: %v", modelName, err)
		return nil, fmt.Errorf("LLM generation failed: %w", err)
	}

	log.Printf("LLM response length: %d chars", len(response))

	// Parse JSON response from LLM
	var result struct {
		Entities []Entity `json:"entities"`
	}

	if err := json.Unmarshal([]byte(response), &result); err != nil {
		// If JSON parsing fails, try to extract from response text
		log.Printf("Failed to parse entity JSON, response was: %s", response)
		return p.extractEntitiesFromText(response, metadata)
	}

	// Normalize and validate entities
	var validEntities []Entity
	for _, entity := range result.Entities {
		// Basic validation
		if entity.Value == "" || entity.Type == "" {
			continue
		}

		// Set normalized value if not provided
		if entity.NormalizedValue == "" {
			entity.NormalizedValue = strings.ToLower(strings.TrimSpace(entity.Value))
		}

		// Ensure confidence is in valid range
		if entity.Confidence > 1.0 {
			entity.Confidence = 1.0
		}
		if entity.Confidence < 0.0 {
			entity.Confidence = 0.0
		}

		validEntities = append(validEntities, entity)
	}

	log.Printf("Extracted %d entities using LLM for content type: %s", len(validEntities), metadata.ContentType)
	return validEntities, nil
}

// extractEntitiesFromText is a fallback when JSON parsing fails
func (p *Processor) extractEntitiesFromText(response string, metadata EntityExtractionMetadata) ([]Entity, error) {
	log.Printf("Attempting fallback entity extraction from LLM response")

	// Simple fallback - look for common patterns in the response
	// This is basic but better than nothing when JSON fails
	entities := []Entity{}

	lines := strings.Split(response, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		// Look for patterns like "- Technology: React" or "Function: authenticate"
		if strings.Contains(line, ":") {
			parts := strings.SplitN(line, ":", 2)
			if len(parts) == 2 {
				entityType := strings.ToLower(strings.TrimSpace(parts[0]))
				entityValue := strings.TrimSpace(parts[1])

				// Clean up common prefixes
				entityType = strings.TrimPrefix(entityType, "- ")
				entityType = strings.TrimPrefix(entityType, "* ")

				if entityValue != "" {
					entities = append(entities, Entity{
						Type:            entityType,
						Value:           entityValue,
						NormalizedValue: strings.ToLower(entityValue),
						Confidence:      0.7, // Lower confidence for fallback
					})
				}
			}
		}
	}

	return entities, nil
}

// storeEntities stores extracted entities in the database with deduplication
func (p *Processor) storeEntities(entities []Entity, task *Task, metadata EntityExtractionMetadata) error {
	db := p.db.GetDB()

	for _, entity := range entities {
		// Check for existing entity with same normalized value in this conversation
		var existingID int64
		checkSQL := `
			SELECT id FROM entities
			WHERE normalized_value = ? AND conversation_id = ? AND entity_type = ?
		`
		err := db.QueryRow(checkSQL, entity.NormalizedValue, metadata.ConversationID, entity.Type).Scan(&existingID)

		if err == nil {
			// Entity already exists for this conversation, skip
			log.Printf("Entity %s (%s) already exists for conversation %v", entity.Value, entity.Type, metadata.ConversationID)
			continue
		}

		// Marshal metadata to JSON
		var metadataJSON *string
		if entity.Metadata != nil {
			if metadataBytes, err := json.Marshal(entity.Metadata); err == nil {
				metadataStr := string(metadataBytes)
				metadataJSON = &metadataStr
			}
		}

		// Insert new entity
		insertSQL := `
			INSERT INTO entities (
				session_id, conversation_id, entity_type, entity_value,
				normalized_value, confidence, context_start, context_end, metadata
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`

		_, err = db.Exec(insertSQL,
			task.SessionID, metadata.ConversationID, entity.Type, entity.Value,
			entity.NormalizedValue, entity.Confidence, entity.ContextStart, entity.ContextEnd, metadataJSON)

		if err != nil {
			log.Printf("Failed to insert entity %s: %v", entity.Value, err)
			continue
		}

		log.Printf("Stored entity: %s (%s) - confidence: %.2f", entity.Value, entity.Type, entity.Confidence)
	}

	return nil
}

// getEntitiesForRelationship retrieves entities from database for relationship analysis
func (p *Processor) getEntitiesForRelationship(entityIDs []int64) ([]Entity, error) {
	if len(entityIDs) == 0 {
		return []Entity{}, nil
	}

	db := p.db.GetDB()

	// Build query with placeholders for the IN clause
	placeholders := make([]string, len(entityIDs))
	args := make([]interface{}, len(entityIDs))
	for i, id := range entityIDs {
		placeholders[i] = "?"
		args[i] = id
	}

	query := fmt.Sprintf(`
		SELECT entity_type, entity_value, normalized_value, confidence,
		       context_start, context_end, metadata
		FROM entities
		WHERE id IN (%s)
	`, fmt.Sprintf(strings.Join(placeholders, ",")))

	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query entities: %w", err)
	}
	defer rows.Close()

	var entities []Entity
	for rows.Next() {
		var entity Entity
		var metadataJSON *string
		var contextStart, contextEnd *int

		err := rows.Scan(&entity.Type, &entity.Value, &entity.NormalizedValue,
			&entity.Confidence, &contextStart, &contextEnd, &metadataJSON)
		if err != nil {
			return nil, fmt.Errorf("failed to scan entity: %w", err)
		}

		if contextStart != nil {
			entity.ContextStart = *contextStart
		}
		if contextEnd != nil {
			entity.ContextEnd = *contextEnd
		}

		// Parse metadata JSON
		if metadataJSON != nil && *metadataJSON != "" {
			if err := json.Unmarshal([]byte(*metadataJSON), &entity.Metadata); err != nil {
				log.Printf("Failed to parse entity metadata: %v", err)
			}
		}

		entities = append(entities, entity)
	}

	return entities, nil
}

// inferRelationshipsWithLLM uses LLM to infer relationships between entities
func (p *Processor) inferRelationshipsWithLLM(entities []Entity, content string, metadata EntityRelationshipMetadata) ([]EntityRelationship, error) {
	// This would use LLM to analyze entity relationships
	// For now, return placeholder
	log.Printf("Would infer relationships between %d entities", len(entities))

	relationships := []EntityRelationship{
		{
			Entity1ID:        1,
			Entity2ID:        2,
			RelationshipType: "uses",
			Confidence:       0.8,
		},
	}

	return relationships, nil
}

// storeRelationships stores entity relationships in the database
func (p *Processor) storeRelationships(relationships []EntityRelationship) error {
	db := p.db.GetDB()

	for _, rel := range relationships {
		// Check for existing relationship to avoid duplicates
		var existingID int64
		checkSQL := `
			SELECT id FROM entity_relationships
			WHERE entity_1_id = ? AND entity_2_id = ? AND relationship_type = ?
		`
		err := db.QueryRow(checkSQL, rel.Entity1ID, rel.Entity2ID, rel.RelationshipType).Scan(&existingID)

		if err == nil {
			// Relationship already exists, skip
			log.Printf("Relationship %d %s %d already exists", rel.Entity1ID, rel.RelationshipType, rel.Entity2ID)
			continue
		}

		// Marshal metadata to JSON
		var metadataJSON *string
		if rel.Metadata != nil {
			if metadataBytes, err := json.Marshal(rel.Metadata); err == nil {
				metadataStr := string(metadataBytes)
				metadataJSON = &metadataStr
			}
		}

		// Insert new relationship
		insertSQL := `
			INSERT INTO entity_relationships (
				entity_1_id, entity_2_id, relationship_type, confidence, metadata
			) VALUES (?, ?, ?, ?, ?)
		`

		_, err = db.Exec(insertSQL, rel.Entity1ID, rel.Entity2ID, rel.RelationshipType, rel.Confidence, metadataJSON)

		if err != nil {
			log.Printf("Failed to insert relationship %d %s %d: %v", rel.Entity1ID, rel.RelationshipType, rel.Entity2ID, err)
			continue
		}

		log.Printf("Stored relationship: %d %s %d (confidence: %.2f)", rel.Entity1ID, rel.RelationshipType, rel.Entity2ID, rel.Confidence)
	}

	return nil
}

// GetOptimalBatchSize returns the optimal batch size for a model
func (p *Processor) GetOptimalBatchSize(modelName string) int {
	switch modelName {
	case "mxbai-embed-large":
		return 10 // Embeddings are relatively fast
	case "gemma3n:latest":
		return 3 // Summarization and entity extraction are slower
	case "llama3.1":
		return 2 // Entity extraction with larger models is slower
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