package taskqueue

import (
	"encoding/json"
	"time"
)

// TaskType represents the type of task to be processed
type TaskType string

const (
	TaskTypeEmbedding         TaskType = "embedding"
	TaskTypeSummarization     TaskType = "summarization"
	TaskTypeEntityExtraction  TaskType = "entity_extraction"
	TaskTypeCodeAnalysis      TaskType = "code_analysis"
)

// TaskStatus represents the current status of a task
type TaskStatus string

const (
	TaskStatusPending    TaskStatus = "pending"
	TaskStatusProcessing TaskStatus = "processing"
	TaskStatusCompleted  TaskStatus = "completed"
	TaskStatusFailed     TaskStatus = "failed"
)

// TaskPriority levels
const (
	PriorityHigh   = 1 // User-initiated tasks
	PriorityNormal = 5 // Default priority
	PriorityLow    = 9 // Background tasks
)

// Task represents a task in the queue
type Task struct {
	ID           int64             `json:"id"`
	TaskType     TaskType          `json:"task_type"`
	ModelName    string            `json:"model_name"`
	Content      string            `json:"content"`
	Metadata     map[string]interface{} `json:"metadata,omitempty"`
	Priority     int               `json:"priority"`
	Status       TaskStatus        `json:"status"`
	SessionID    *int64            `json:"session_id,omitempty"`
	CreatedAt    time.Time         `json:"created_at"`
	ProcessedAt  *time.Time        `json:"processed_at,omitempty"`
	RetryCount   int               `json:"retry_count"`
	ErrorMessage *string           `json:"error_message,omitempty"`
}

// EmbeddingMetadata contains metadata for embedding tasks
type EmbeddingMetadata struct {
	OriginalLength   int    `json:"original_length"`
	ProcessingMode   string `json:"processing_mode"`
	ConversationID   *int64 `json:"conversation_id,omitempty"`
	ContentType      string `json:"content_type"` // "prompt", "response", "tool_output"
}

// SummarizationMetadata contains metadata for summarization tasks
type SummarizationMetadata struct {
	OriginalLength int    `json:"original_length"`
	Mode          string `json:"mode"` // "light", "extract"
	MaxLength     int    `json:"max_length"`
}

// TaskResult represents the result of a processed task
type TaskResult struct {
	TaskID    int64       `json:"task_id"`
	Success   bool        `json:"success"`
	Result    interface{} `json:"result,omitempty"`
	Error     string      `json:"error,omitempty"`
	Duration  time.Duration `json:"duration"`
}

// EmbeddingResult contains the result of an embedding task
type EmbeddingResult struct {
	Embedding      []float32 `json:"embedding"`
	ProcessedText  string    `json:"processed_text"`
	ProcessingMode string    `json:"processing_mode"`
}

// Helper methods for metadata handling

// SetMetadata sets the metadata field from a struct
func (t *Task) SetMetadata(metadata interface{}) error {
	data, err := json.Marshal(metadata)
	if err != nil {
		return err
	}

	return json.Unmarshal(data, &t.Metadata)
}

// GetMetadata gets the metadata field into a struct
func (t *Task) GetMetadata(target interface{}) error {
	if t.Metadata == nil {
		return nil
	}

	data, err := json.Marshal(t.Metadata)
	if err != nil {
		return err
	}

	return json.Unmarshal(data, target)
}