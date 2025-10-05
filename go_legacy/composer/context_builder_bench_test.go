package composer

import (
	"strings"
	"testing"
)

// BenchmarkFormatContext tests the optimized string building
func BenchmarkFormatContext(b *testing.B) {
	cb := &ContextBuilder{}

	// Create test data
	parts := []string{
		"This is a sample conversation from the past.",
		"Here's another important context piece with relevant information.",
		"Additional context that helps understand the conversation flow.",
		"More historical data that provides background.",
		"Final piece of context with concluding information.",
	}

	b.Run("OptimizedWithBuilder", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			_ = cb.formatContext(parts, "dere")
		}
	})

	b.Run("OldWithJoin", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			_ = formatContextOld(parts, "dere")
		}
	})
}

// Old implementation for comparison
func formatContextOld(parts []string, personality string) string {
	var header string

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

// BenchmarkInjectContext tests the context injection optimization
func BenchmarkInjectContext(b *testing.B) {
	// Test data
	prompt := `You are an AI assistant.

---

Please help the user with their request.

---

Be helpful and friendly.`

	context := `Previous conversation:
User asked about optimization.
Assistant provided guidance on performance improvements.
The discussion covered memory management and concurrency.`

	b.ResetTimer()
	b.Run("OptimizedWithBuilder", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			_ = InjectContext(prompt, context)
		}
	})

	b.Run("OldWithJoin", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			_ = injectContextOld(prompt, context)
		}
	})
}

// Old implementation for comparison
func injectContextOld(prompt string, context string) string {
	if context == "" {
		return prompt
	}

	parts := strings.Split(prompt, "\n\n---\n\n")

	if len(parts) > 1 {
		newParts := []string{parts[0], context}
		newParts = append(newParts, parts[1:]...)
		return strings.Join(newParts, "\n\n---\n\n")
	}

	return context + "\n\n---\n\n" + prompt
}

// BenchmarkStringConcatenation compares different string concatenation methods
func BenchmarkStringConcatenation(b *testing.B) {
	parts := make([]string, 100)
	for i := range parts {
		parts[i] = "This is a sample string part that represents typical content."
	}

	b.Run("StringsBuilder", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			var builder strings.Builder
			for _, part := range parts {
				builder.WriteString(part)
				builder.WriteString("\n")
			}
			_ = builder.String()
		}
	})

	b.Run("StringsJoin", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			_ = strings.Join(parts, "\n")
		}
	})

	b.Run("PlusEquals", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			result := ""
			for _, part := range parts {
				result += part + "\n"
			}
			_ = result
		}
	})
}

// BenchmarkEstimateTokenCount tests token estimation performance
func BenchmarkEstimateTokenCount(b *testing.B) {
	cb := &ContextBuilder{}

	// Typical context size
	text := strings.Repeat("This is a sample text for token counting. ", 100)

	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = cb.estimateTokenCount(text)
	}
}