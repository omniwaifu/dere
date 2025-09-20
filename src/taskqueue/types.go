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
	TaskTypeEntityRelationship TaskType = "entity_relationship"
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

// EntityExtractionMetadata contains metadata for entity extraction tasks
type EntityExtractionMetadata struct {
	OriginalLength   int      `json:"original_length"`
	ContentType      string   `json:"content_type"` // "prompt", "response", "tool_output"
	ConversationID   *int64   `json:"conversation_id,omitempty"`
	ContextHint      string   `json:"context_hint"` // "coding", "general", "project"
	FocusEntityTypes []string `json:"focus_entity_types,omitempty"` // ["code", "tech", "people"]
}

// EntityRelationshipMetadata contains metadata for relationship inference tasks
type EntityRelationshipMetadata struct {
	EntityIDs        []int64 `json:"entity_ids"`
	ConversationID   int64   `json:"conversation_id"`
	RelationshipHint string  `json:"relationship_hint"` // "technical", "social", "project"
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

// Entity represents an extracted entity
type Entity struct {
	Type           string                 `json:"type"`
	Value          string                 `json:"value"`
	NormalizedValue string                `json:"normalized_value"`
	Confidence     float64                `json:"confidence"`
	ContextStart   int                    `json:"context_start,omitempty"`
	ContextEnd     int                    `json:"context_end,omitempty"`
	Metadata       map[string]interface{} `json:"metadata,omitempty"`
}

// EntityExtractionResult contains the result of an entity extraction task
type EntityExtractionResult struct {
	Entities       []Entity `json:"entities"`
	TotalExtracted int      `json:"total_extracted"`
	ProcessingMode string   `json:"processing_mode"`
}

// EntityRelationship represents a relationship between entities
type EntityRelationship struct {
	Entity1ID        int64                  `json:"entity_1_id"`
	Entity2ID        int64                  `json:"entity_2_id"`
	RelationshipType string                 `json:"relationship_type"`
	Confidence       float64                `json:"confidence"`
	Metadata         map[string]interface{} `json:"metadata,omitempty"`
}

// EntityRelationshipResult contains the result of a relationship inference task
type EntityRelationshipResult struct {
	Relationships   []EntityRelationship `json:"relationships"`
	TotalInferred   int                  `json:"total_inferred"`
}

// SummarizationResult contains the result of a summarization task
type SummarizationResult struct {
	Summary        string `json:"summary"`
	OriginalLength int    `json:"original_length"`
	SummaryLength  int    `json:"summary_length"`
	Mode           string `json:"mode"`
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