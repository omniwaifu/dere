package taskqueue

import (
	"encoding/json"
	"fmt"
	"time"
)

// TypedTask represents a task with strongly-typed metadata
type TypedTask[T any] struct {
	ID           int64      `json:"id"`
	TaskType     TaskType   `json:"task_type"`
	ModelName    string     `json:"model_name"`
	Content      string     `json:"content"`
	Metadata     T          `json:"metadata,omitempty"`
	Priority     int        `json:"priority"`
	Status       TaskStatus `json:"status"`
	SessionID    *int64     `json:"session_id,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	ProcessedAt  *time.Time `json:"processed_at,omitempty"`
	RetryCount   int        `json:"retry_count"`
	ErrorMessage *string    `json:"error_message,omitempty"`
}

// Specific task types with proper metadata
type EmbeddingTask = TypedTask[EmbeddingMetadata]
type SummarizationTask = TypedTask[SummarizationMetadata]
type EntityExtractionTask = TypedTask[EntityExtractionMetadata]
type ContextBuildingTask = TypedTask[ContextBuildingMetadata]
// ProgressiveSummarizationMetadata for progressive summarization tasks
type ProgressiveSummarizationMetadata struct {
	SessionID      int64  `json:"session_id"`
	SegmentNumber  int    `json:"segment_number"`
	OriginalLength int    `json:"original_length"`
	TargetLength   int    `json:"target_length"`
	Mode           string `json:"mode"`
}

type ProgressiveSummaryTask = TypedTask[ProgressiveSummarizationMetadata]

// TaskConverter provides safe conversion between Task and TypedTask
type TaskConverter struct{}

// ToTypedEmbeddingTask converts a generic Task to EmbeddingTask
func (tc *TaskConverter) ToTypedEmbeddingTask(task *Task) (*EmbeddingTask, error) {
	if task.TaskType != TaskTypeEmbedding {
		return nil, fmt.Errorf("invalid task type: expected %s, got %s", TaskTypeEmbedding, task.TaskType)
	}

	var metadata EmbeddingMetadata
	if task.Metadata != nil {
		// Convert map to struct via JSON round-trip
		data, err := json.Marshal(task.Metadata)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal metadata: %w", err)
		}
		if err := json.Unmarshal(data, &metadata); err != nil {
			return nil, fmt.Errorf("failed to unmarshal to EmbeddingMetadata: %w", err)
		}
	}

	return &EmbeddingTask{
		ID:           task.ID,
		TaskType:     task.TaskType,
		ModelName:    task.ModelName,
		Content:      task.Content,
		Metadata:     metadata,
		Priority:     task.Priority,
		Status:       task.Status,
		SessionID:    task.SessionID,
		CreatedAt:    task.CreatedAt,
		ProcessedAt:  task.ProcessedAt,
		RetryCount:   task.RetryCount,
		ErrorMessage: task.ErrorMessage,
	}, nil
}

// ToTypedSummarizationTask converts a generic Task to SummarizationTask
func (tc *TaskConverter) ToTypedSummarizationTask(task *Task) (*SummarizationTask, error) {
	if task.TaskType != TaskTypeSummarization {
		return nil, fmt.Errorf("invalid task type: expected %s, got %s", TaskTypeSummarization, task.TaskType)
	}

	var metadata SummarizationMetadata
	if task.Metadata != nil {
		data, err := json.Marshal(task.Metadata)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal metadata: %w", err)
		}
		if err := json.Unmarshal(data, &metadata); err != nil {
			return nil, fmt.Errorf("failed to unmarshal to SummarizationMetadata: %w", err)
		}
	}

	return &SummarizationTask{
		ID:           task.ID,
		TaskType:     task.TaskType,
		ModelName:    task.ModelName,
		Content:      task.Content,
		Metadata:     metadata,
		Priority:     task.Priority,
		Status:       task.Status,
		SessionID:    task.SessionID,
		CreatedAt:    task.CreatedAt,
		ProcessedAt:  task.ProcessedAt,
		RetryCount:   task.RetryCount,
		ErrorMessage: task.ErrorMessage,
	}, nil
}

// FromTypedTask converts a TypedTask back to generic Task
func FromTypedTask[T any](typed *TypedTask[T]) (*Task, error) {
	// Convert metadata to map via JSON
	var metadataMap map[string]interface{}

	// Use reflection to check if metadata is set (works with any type)
	data, err := json.Marshal(typed.Metadata)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal typed metadata: %w", err)
	}

	// Only unmarshal if we have actual data
	if len(data) > 0 && string(data) != "null" && string(data) != "{}" {
		if err := json.Unmarshal(data, &metadataMap); err != nil {
			return nil, fmt.Errorf("failed to unmarshal to map: %w", err)
		}
	}

	return &Task{
		ID:           typed.ID,
		TaskType:     typed.TaskType,
		ModelName:    typed.ModelName,
		Content:      typed.Content,
		Metadata:     metadataMap,
		Priority:     typed.Priority,
		Status:       typed.Status,
		SessionID:    typed.SessionID,
		CreatedAt:    typed.CreatedAt,
		ProcessedAt:  typed.ProcessedAt,
		RetryCount:   typed.RetryCount,
		ErrorMessage: typed.ErrorMessage,
	}, nil
}

// TaskBuilder provides a fluent interface for building typed tasks
type TaskBuilder[T any] struct {
	task TypedTask[T]
}

// NewTaskBuilder creates a new task builder
func NewTaskBuilder[T any](taskType TaskType) *TaskBuilder[T] {
	return &TaskBuilder[T]{
		task: TypedTask[T]{
			TaskType:  taskType,
			Priority:  PriorityNormal,
			Status:    TaskStatusPending,
			CreatedAt: time.Now(),
		},
	}
}

func (b *TaskBuilder[T]) WithModel(model string) *TaskBuilder[T] {
	b.task.ModelName = model
	return b
}

func (b *TaskBuilder[T]) WithContent(content string) *TaskBuilder[T] {
	b.task.Content = content
	return b
}

func (b *TaskBuilder[T]) WithMetadata(metadata T) *TaskBuilder[T] {
	b.task.Metadata = metadata
	return b
}

func (b *TaskBuilder[T]) WithPriority(priority int) *TaskBuilder[T] {
	b.task.Priority = priority
	return b
}

func (b *TaskBuilder[T]) WithSessionID(sessionID int64) *TaskBuilder[T] {
	b.task.SessionID = &sessionID
	return b
}

func (b *TaskBuilder[T]) Build() *TypedTask[T] {
	return &b.task
}

// Example usage functions demonstrating type safety

// CreateEmbeddingTask creates a new embedding task with type safety
func CreateEmbeddingTask(content string, sessionID int64, mode string) *EmbeddingTask {
	return NewTaskBuilder[EmbeddingMetadata](TaskTypeEmbedding).
		WithContent(content).
		WithSessionID(sessionID).
		WithMetadata(EmbeddingMetadata{
			OriginalLength: len(content),
			ProcessingMode: mode,
			ContentType:    "prompt",
		}).
		WithModel("nomic-embed-text").
		Build()
}

// CreateSummarizationTask creates a new summarization task with type safety
func CreateSummarizationTask(content string, sessionID int64, maxLength int) *SummarizationTask {
	return NewTaskBuilder[SummarizationMetadata](TaskTypeSummarization).
		WithContent(content).
		WithSessionID(sessionID).
		WithMetadata(SummarizationMetadata{
			OriginalLength: len(content),
			Mode:          "light",
			MaxLength:     maxLength,
		}).
		WithModel("llama3.2:3b").
		Build()
}