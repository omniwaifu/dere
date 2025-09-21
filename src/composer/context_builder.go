package composer

import (
	"fmt"
	"log"
	"strings"
	"time"

	"dere/src/database"
	"dere/src/embeddings"
	"dere/src/taskqueue"
)

// ContextBuilder handles building intelligent context from conversation history
type ContextBuilder struct {
	db         *database.TursoDB
	embeddings *embeddings.OllamaClient
}

// NewContextBuilder creates a new context builder
func NewContextBuilder(db *database.TursoDB, embeddings *embeddings.OllamaClient) *ContextBuilder {
	return &ContextBuilder{
		db:         db,
		embeddings: embeddings,
	}
}

// BuildContext builds context for a session based on various sources
func (cb *ContextBuilder) BuildContext(metadata taskqueue.ContextBuildingMetadata) (*taskqueue.ContextBuildingResult, error) {
	result := &taskqueue.ContextBuildingResult{
		ContextSources:     []taskqueue.ContextSource{},
		EntitiesIncluded:   []string{},
		SessionsReferenced: []int64{},
	}

	var contextParts []string
	totalTokens := 0
	maxTokens := metadata.MaxTokens
	if maxTokens == 0 {
		maxTokens = 2000 // Default max context size
	}

	// 1. Check for cached context first
	if cached, found := cb.db.GetCachedContext(metadata.SessionID, 30*time.Minute); found {
		result.Context = cached
		result.TotalTokens = cb.estimateTokenCount(cached)
		return result, nil
	}

	// 2. Get recent session summaries
	if metadata.ContextMode == "summary" || metadata.ContextMode == "smart" {
		summaries, err := cb.db.GetRecentSessionSummaries(3, metadata.ProjectPath, &metadata.SessionID)
		log.Printf("Context building: project_path='%s', exclude_session=%d, found %d summaries, err=%v",
			metadata.ProjectPath, metadata.SessionID, len(summaries), err)
		if err == nil && len(summaries) > 0 {
			for _, summary := range summaries {
				tokens := cb.estimateTokenCount(summary.Summary)
				if totalTokens+tokens > maxTokens {
					break
				}

				contextParts = append(contextParts, fmt.Sprintf("Previous session summary:\n%s", summary.Summary))
				result.ContextSources = append(result.ContextSources, taskqueue.ContextSource{
					Type:           "summary",
					SourceID:       summary.SessionID,
					Content:        summary.Summary,
					RelevanceScore: 0.9, // Summaries are highly relevant
					Tokens:         tokens,
				})
				result.SessionsReferenced = append(result.SessionsReferenced, summary.SessionID)
				totalTokens += tokens
			}
		}
	}

	// 3. Find semantically similar conversations if we have a prompt
	if metadata.CurrentPrompt != "" && (metadata.ContextMode == "full" || metadata.ContextMode == "smart") {
		// Generate embedding for the current prompt
		embedding, err := cb.embeddings.GetEmbedding(metadata.CurrentPrompt)
		if err == nil && embedding != nil {
			// Find similar conversations (exclude current session, no specific conversation to exclude yet)
			similar, err := cb.db.FindSimilarConversations(embedding, metadata.ContextDepth, &metadata.SessionID, nil)
			if err == nil {
				for _, conv := range similar {
					// Only include highly relevant conversations (similarity > 0.7)
					if conv.Similarity < 0.7 {
						continue
					}

					tokens := cb.estimateTokenCount(conv.Prompt)
					if totalTokens+tokens > maxTokens {
						break
					}

					contextParts = append(contextParts, fmt.Sprintf("Related past conversation (%.1f%% similar):\n%s",
						conv.Similarity*100, conv.Prompt))
					result.ContextSources = append(result.ContextSources, taskqueue.ContextSource{
						Type:           "conversation",
						SourceID:       conv.ConversationID,
						Content:        conv.Prompt,
						RelevanceScore: conv.Similarity,
						Tokens:         tokens,
					})

					// Track unique sessions
					if !contains(result.SessionsReferenced, conv.SessionID) {
						result.SessionsReferenced = append(result.SessionsReferenced, conv.SessionID)
					}
					totalTokens += tokens
				}
			}
		}
	}

	// 4. Get related sessions for additional context
	if metadata.ContextMode == "full" || (metadata.ContextMode == "smart" && totalTokens < maxTokens/2) {
		related, err := cb.db.GetRelatedSessions(metadata.SessionID, 3)
		if err == nil {
			for _, session := range related {
				// Skip if we already have content from this session
				if contains(result.SessionsReferenced, session.ID) {
					continue
				}

				// Try to get a summary for this session
				summaries, err := cb.db.GetRecentSessionSummaries(1, "", &session.ID)
				if err == nil && len(summaries) > 0 {
					tokens := cb.estimateTokenCount(summaries[0].Summary)
					if totalTokens+tokens > maxTokens {
						break
					}

					contextParts = append(contextParts, fmt.Sprintf("Related session context:\n%s", summaries[0].Summary))
					result.ContextSources = append(result.ContextSources, taskqueue.ContextSource{
						Type:           "summary",
						SourceID:       session.ID,
						Content:        summaries[0].Summary,
						RelevanceScore: 0.7, // Related sessions are moderately relevant
						Tokens:         tokens,
					})
					result.SessionsReferenced = append(result.SessionsReferenced, session.ID)
					totalTokens += tokens
				}
			}
		}
	}

	// 5. Build the final context
	if len(contextParts) > 0 {
		result.Context = cb.formatContext(contextParts, metadata.Personality)
		result.TotalTokens = totalTokens
		result.RelevanceScore = cb.calculateOverallRelevance(result.ContextSources)

		// Cache the built context
		cacheMetadata := map[string]interface{}{
			"sources":      len(result.ContextSources),
			"tokens":       totalTokens,
			"mode":         metadata.ContextMode,
			"sessions":     result.SessionsReferenced,
		}
		cb.db.StoreContextCache(metadata.SessionID, result.Context, cacheMetadata)
	}

	return result, nil
}

// formatContext formats the context parts based on personality
func (cb *ContextBuilder) formatContext(parts []string, personality string) string {
	var header string

	// Adjust formatting based on personality
	switch personality {
	case "tsun":
		header = "## Previous Interactions (not that you need reminding...)"
	case "kuu":
		header = "## Historical Context"
	case "yan":
		header = "## Our Previous Conversations Together! 💕"
	case "dere":
		header = "## Previous Context"
	case "ero":
		header = "## Our History Together~"
	default:
		header = "## Conversation Context"
	}

	context := []string{header}
	context = append(context, parts...)

	return strings.Join(context, "\n\n")
}

// estimateTokenCount provides a rough estimate of token count
func (cb *ContextBuilder) estimateTokenCount(text string) int {
	// Rough estimate: 1 token per 4 characters
	return len(text) / 4
}

// calculateOverallRelevance calculates the weighted average relevance
func (cb *ContextBuilder) calculateOverallRelevance(sources []taskqueue.ContextSource) float64 {
	if len(sources) == 0 {
		return 0
	}

	totalScore := 0.0
	totalTokens := 0

	for _, source := range sources {
		totalScore += source.RelevanceScore * float64(source.Tokens)
		totalTokens += source.Tokens
	}

	if totalTokens == 0 {
		return 0
	}

	return totalScore / float64(totalTokens)
}

// contains checks if a slice contains a value
func contains(slice []int64, val int64) bool {
	for _, item := range slice {
		if item == val {
			return true
		}
	}
	return false
}

// InjectContext adds context to the composed prompt
func InjectContext(prompt string, context string) string {
	if context == "" {
		return prompt
	}

	// Insert context before the main conversation but after system instructions
	parts := strings.Split(prompt, "\n\n---\n\n")

	if len(parts) > 1 {
		// Insert context as the second layer (after main prompt, before personality)
		newParts := []string{parts[0], context}
		newParts = append(newParts, parts[1:]...)
		return strings.Join(newParts, "\n\n---\n\n")
	}

	// If no layers, just prepend context
	return context + "\n\n---\n\n" + prompt
}