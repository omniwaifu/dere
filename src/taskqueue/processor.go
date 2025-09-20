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
	queue             *Queue
	db                *database.TursoDB
	ollama            *embeddings.OllamaClient
	maxRetries        int
	currentModel      string
	modelContextCache map[string]int
}

// NewProcessor creates a new task processor
func NewProcessor(queue *Queue, db *database.TursoDB, ollama *embeddings.OllamaClient) *Processor {
	return &Processor{
		queue:             queue,
		db:                db,
		ollama:            ollama,
		maxRetries:        3,
		modelContextCache: make(map[string]int),
	}
}

// ProcessTasks processes tasks in batches by model to minimize switching
func (p *Processor) ProcessTasks() error {
	// Check database health before processing
	if err := p.db.GetDB().Ping(); err != nil {
		log.Printf("Database connection unhealthy, skipping task processing: %v", err)
		return fmt.Errorf("database connection failed: %w", err)
	}

	tasksByModel, err := p.queue.GetTasksByModel()
	if err != nil {
		log.Printf("Failed to get tasks by model: %v", err)
		return fmt.Errorf("failed to get tasks by model: %w", err)
	}

	if len(tasksByModel) == 0 {
		log.Printf("No tasks to process")
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
				// Continue with next task instead of stopping processor
				continue
			}
		}
	}

	return nil
}

// getTaskDescription returns a human-readable description of what the task does
func (p *Processor) getTaskDescription(task *Task) string {
	switch task.TaskType {
	case TaskTypeEmbedding:
		if task.SessionID != nil {
			return fmt.Sprintf("embedding for session %d", *task.SessionID)
		}
		return "embedding"
	case TaskTypeSummarization:
		if task.Metadata != nil {
			if mode, ok := task.Metadata["mode"].(string); ok {
				if mode == "session" && task.SessionID != nil {
					return fmt.Sprintf("session summarization for session %d", *task.SessionID)
				}
				return fmt.Sprintf("summarization (%s mode)", mode)
			}
		}
		return "summarization"
	case TaskTypeEntityExtraction:
		if task.Metadata != nil {
			if contentType, ok := task.Metadata["content_type"].(string); ok {
				return fmt.Sprintf("entity extraction for %s", contentType)
			}
		}
		return "entity extraction"
	case TaskTypeEntityRelationship:
		return "entity relationship analysis"
	default:
		return fmt.Sprintf("unknown task type: %s", task.TaskType)
	}
}

// processTask processes a single task
func (p *Processor) processTask(task *Task) error {
	// Mark as processing
	if err := p.queue.UpdateStatus(task.ID, TaskStatusProcessing, nil); err != nil {
		log.Printf("Failed to mark task %d as processing (database lock?): %v", task.ID, err)
		// Continue processing task anyway, just log the error
		log.Printf("Continuing to process task %d despite status update failure", task.ID)
	}

	// Log task start with description
	log.Printf("Task %d starting: %s", task.ID, p.getTaskDescription(task))

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

	log.Printf("Starting summarization of %d chars using mode: %s", metadata.OriginalLength, metadata.Mode)

	// Check if content needs progressive summarization for session mode
	if metadata.Mode == "session" && task.SessionID != nil {
		needsProgressive := p.needsProgressiveSummarization(task.Content, task.ModelName)
		if needsProgressive {
			log.Printf("Content too long for model context, switching to progressive summarization")
			return p.processProgressiveSummarization(task, metadata, start)
		}
	}

	// Regular summarization
	prompt := p.buildSummarizationPrompt(task.Content, metadata, task.ModelName)

	// Generate summary using LLM (no schema for free text output)
	log.Printf("Summarization prompt for task %d:\n%s", task.ID, prompt)
	summary, err := p.ollama.GenerateWithModel(prompt, task.ModelName, nil)
	if err != nil {
		log.Printf("Summarization failed for task %d: %v", task.ID, err)
		return &TaskResult{
			TaskID:   task.ID,
			Success:  false,
			Error:    err.Error(),
			Duration: time.Since(start),
		}, nil
	}

	log.Printf("Generated summary of %d chars from original %d chars", len(summary), metadata.OriginalLength)

	// Store summary result
	result := &SummarizationResult{
		Summary:        summary,
		OriginalLength: metadata.OriginalLength,
		SummaryLength:  len(summary),
		Mode:          metadata.Mode,
	}

	// If this is a session summary, store it in the database
	if metadata.Mode == "session" && task.SessionID != nil {
		if err := p.storeSessionSummary(*task.SessionID, summary, metadata); err != nil {
			log.Printf("Failed to store session summary: %v", err)
		}
	}

	return &TaskResult{
		TaskID:   task.ID,
		Success:  true,
		Result:   result,
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

	// Call Ollama to generate entity extraction using the specified model with entity schema
	response, err := p.ollama.GenerateWithModel(prompt, modelName, embeddings.GetEntityExtractionSchema())
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

// buildSummarizationPrompt builds an appropriate summarization prompt based on mode
func (p *Processor) buildSummarizationPrompt(content string, metadata SummarizationMetadata, modelName string) string {
	var template string

	switch metadata.Mode {
	case "session":
		template = `%s

Your task: Summarize the conversation below. Do not use numbered lists, bullet points, or structured formatting. Write in plain paragraphs only.

Conversation:
%s

Summary (max %d words):`

	case "progressive_session":
		// This mode will be handled specially in processSummarizationTask
		template = `Summarize the following conversation segment. Do not use numbered lists, bullet points, or structured formatting. Write in plain paragraphs only.

%s

Summary (max %d words):`

	case "extract":
		template = `Extract the key information from this text for semantic search.
Focus on the most important concepts, entities, and actions.
Keep technical terms and proper nouns intact.

Text:
%s

Provide an extractive summary (max %d words) that preserves searchability.`

	case "light":
		template = `Provide a brief summary of this text, preserving key terms:
%s

Summary (max %d words):`

	default:
		template = `Summarize this text:
%s

Summary (max %d words):`
	}

	// Add personality context if available
	personalityContext := ""
	if metadata.Personality != "" {
		personalityContext = metadata.Personality
	}

	// For progressive modes, content is already segmented appropriately
	// For regular modes, assume content length is already appropriate (handled by progressive summarization)
	return fmt.Sprintf(template, personalityContext, content, metadata.MaxLength)
}

// storeSessionSummary stores a session summary in the database
func (p *Processor) storeSessionSummary(sessionID int64, summary string, metadata SummarizationMetadata) error {
	db := p.db.GetDB()

	// Extract key entities from the session
	var keyEntities []int64
	entitySQL := `
		SELECT DISTINCT e.id
		FROM entities e
		WHERE e.session_id = ?
		ORDER BY e.confidence DESC
		LIMIT 10
	`
	rows, err := db.Query(entitySQL, sessionID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var entityID int64
			if err := rows.Scan(&entityID); err == nil {
				keyEntities = append(keyEntities, entityID)
			}
		}
	}

	// Extract key topics from summary (could be enhanced with LLM)
	topics := extractKeyTopics(summary)

	// Prepare JSON data
	keyEntitiesJSON, _ := json.Marshal(keyEntities)
	keyTopicsJSON, _ := json.Marshal(topics)

	// Insert summary
	insertSQL := `
		INSERT INTO session_summaries (
			session_id, summary_type, summary,
			key_topics, key_entities, model_used, processing_time_ms
		) VALUES (?, ?, ?, ?, ?, ?, ?)
	`

	_, err = db.Exec(insertSQL,
		sessionID,
		"exit", // or metadata.Mode if we want to track different types
		summary,
		string(keyTopicsJSON),
		string(keyEntitiesJSON),
		"gemma3n:latest", // Could be passed in metadata
		0, // Processing time could be calculated
	)

	if err != nil {
		return fmt.Errorf("failed to store session summary: %w", err)
	}

	log.Printf("Stored session summary for session %d", sessionID)
	return nil
}

// extractKeyTopics extracts key topics from text (basic implementation)
func extractKeyTopics(text string) []string {
	// This is a simple implementation - could be enhanced with LLM
	topics := []string{}

	// Look for common topic indicators
	keywords := []string{
		"implement", "fix", "debug", "create", "update",
		"entity", "extraction", "summary", "session",
		"bug", "feature", "refactor", "optimize",
	}

	lowerText := strings.ToLower(text)
	for _, keyword := range keywords {
		if strings.Contains(lowerText, keyword) {
			topics = append(topics, keyword)
			if len(topics) >= 5 {
				break
			}
		}
	}

	return topics
}

// getModelContextLength returns the context length for a model, using cache if available
func (p *Processor) getModelContextLength(modelName string) int {
	// Check cache first
	if contextLength, exists := p.modelContextCache[modelName]; exists {
		return contextLength
	}

	// Query from Ollama API
	contextLength, err := p.ollama.GetModelContextLength(modelName)
	if err != nil {
		log.Printf("Warning: Failed to get context length for model %s: %v. Using default 2048", modelName, err)
		contextLength = 2048
	}

	// Cache the result
	p.modelContextCache[modelName] = contextLength
	log.Printf("Cached context length for model %s: %d tokens", modelName, contextLength)

	return contextLength
}

// processProgressiveSummarization handles progressive summarization for long conversations
func (p *Processor) processProgressiveSummarization(task *Task, metadata SummarizationMetadata, start time.Time) (*TaskResult, error) {
	sessionID := *task.SessionID
	log.Printf("Starting progressive summarization for session %d", sessionID)

	// Get context length for this model
	contextLength := p.getModelContextLength(task.ModelName)

	// Calculate safe segment size (70% of context, accounting for prompt overhead)
	templateOverhead := 500 // Rough estimate for prompt template
	maxSegmentTokens := int(float64(contextLength) * 0.7) - templateOverhead
	maxSegmentChars := maxSegmentTokens * 4 // Rough token-to-char conversion

	// Break content into segments
	segments := p.breakIntoSegments(task.Content, maxSegmentChars)
	log.Printf("Broke conversation into %d segments (max %d chars each)", len(segments), maxSegmentChars)

	// Process each segment and store intermediate summaries
	var segmentSummaries []string
	for i, segment := range segments {
		log.Printf("Processing segment %d/%d (%d chars)", i+1, len(segments), len(segment))

		// Create segment summary
		segmentMetadata := SummarizationMetadata{
			OriginalLength: len(segment),
			Mode:          "progressive_session",
			MaxLength:     300, // More detailed for intermediate summaries
		}

		prompt := p.buildSummarizationPrompt(segment, segmentMetadata, task.ModelName)
		summary, err := p.ollama.GenerateWithModel(prompt, task.ModelName, nil)
		if err != nil {
			log.Printf("Failed to summarize segment %d: %v", i+1, err)
			return &TaskResult{
				TaskID:   task.ID,
				Success:  false,
				Error:    fmt.Sprintf("failed to summarize segment %d: %v", i+1, err),
				Duration: time.Since(start),
			}, nil
		}

		segmentSummaries = append(segmentSummaries, summary)

		// Store segment summary in database
		err = p.storeConversationSegment(sessionID, i+1, segment, summary, task.ModelName)
		if err != nil {
			log.Printf("Warning: Failed to store segment %d summary: %v", i+1, err)
		}

		log.Printf("Completed segment %d: %d chars -> %d chars", i+1, len(segment), len(summary))
	}

	// Create final consolidated summary from all segment summaries
	log.Printf("Creating final consolidated summary from %d segment summaries", len(segmentSummaries))

	consolidatedContent := strings.Join(segmentSummaries, "\n\n--- SEGMENT BREAK ---\n\n")
	finalMetadata := SummarizationMetadata{
		OriginalLength: len(consolidatedContent),
		Mode:          "session", // Use regular session mode for final summary
		MaxLength:     200,
	}

	finalPrompt := fmt.Sprintf(`Create a comprehensive summary from these segment summaries of a Claude Code session:

%s

Provide a cohesive final summary (max %d words) that captures the overall session.`,
		consolidatedContent, finalMetadata.MaxLength)

	finalSummary, err := p.ollama.GenerateWithModel(finalPrompt, task.ModelName, nil)
	if err != nil {
		log.Printf("Failed to create final summary: %v", err)
		return &TaskResult{
			TaskID:   task.ID,
			Success:  false,
			Error:    fmt.Sprintf("failed to create final summary: %v", err),
			Duration: time.Since(start),
		}, nil
	}

	log.Printf("Progressive summarization completed: %d chars -> %d segments -> %d chars final",
		metadata.OriginalLength, len(segments), len(finalSummary))

	// Store the final summary as a regular session summary
	finalResult := &SummarizationResult{
		Summary:        finalSummary,
		OriginalLength: metadata.OriginalLength,
		SummaryLength:  len(finalSummary),
		Mode:          metadata.Mode,
	}

	// Store final session summary
	if err := p.storeSessionSummary(sessionID, finalSummary, finalMetadata); err != nil {
		log.Printf("Failed to store final session summary: %v", err)
	}

	return &TaskResult{
		TaskID:   task.ID,
		Success:  true,
		Result:   finalResult,
		Duration: time.Since(start),
	}, nil
}

// breakIntoSegments breaks content into segments that fit within context limits
func (p *Processor) breakIntoSegments(content string, maxSegmentChars int) []string {
	if len(content) <= maxSegmentChars {
		return []string{content}
	}

	var segments []string
	remaining := content

	for len(remaining) > 0 {
		if len(remaining) <= maxSegmentChars {
			segments = append(segments, remaining)
			break
		}

		// Find a good break point (prefer breaking on double newlines, then single newlines, then spaces)
		segmentEnd := maxSegmentChars

		// Look for double newline within last 20% of segment
		searchStart := int(float64(maxSegmentChars) * 0.8)
		if doubleNewline := strings.LastIndex(remaining[:maxSegmentChars], "\n\n"); doubleNewline >= searchStart {
			segmentEnd = doubleNewline + 2
		} else if newline := strings.LastIndex(remaining[:maxSegmentChars], "\n"); newline >= searchStart {
			segmentEnd = newline + 1
		} else if space := strings.LastIndex(remaining[:maxSegmentChars], " "); space >= searchStart {
			segmentEnd = space + 1
		}

		segments = append(segments, remaining[:segmentEnd])
		remaining = remaining[segmentEnd:]
	}

	return segments
}

// storeConversationSegment stores an intermediate segment summary in the database
func (p *Processor) storeConversationSegment(sessionID int64, segmentNumber int, originalContent, summary, modelUsed string) error {
	db := p.db.GetDB()

	insertSQL := `
		INSERT INTO conversation_segments (
			session_id, segment_number, segment_summary,
			original_length, summary_length, model_used
		) VALUES (?, ?, ?, ?, ?, ?)
	`

	_, err := db.Exec(insertSQL,
		sessionID,
		segmentNumber,
		summary,
		len(originalContent),
		len(summary),
		modelUsed,
	)

	if err != nil {
		return fmt.Errorf("failed to store conversation segment: %w", err)
	}

	log.Printf("Stored conversation segment %d for session %d", segmentNumber, sessionID)
	return nil
}

// needsProgressiveSummarization determines if content is too long for model context
func (p *Processor) needsProgressiveSummarization(content string, modelName string) bool {
	contextLength := p.getModelContextLength(modelName)

	// Calculate safe content size (70% of context, accounting for prompt overhead)
	templateOverhead := 500 // Rough estimate for prompt template
	maxContentTokens := int(float64(contextLength) * 0.7) - templateOverhead
	maxContentChars := maxContentTokens * 4 // Rough token-to-char conversion

	contentLength := len(content)
	if contentLength > maxContentChars {
		log.Printf("Content (%d chars) exceeds model %s context limit (%d tokens, %d chars max), needs progressive summarization",
			contentLength, modelName, contextLength, maxContentChars)
		return true
	}

	return false
}



