package personality

// Personality defines the interface for all personality types
type Personality interface {
	GetPrompt() string
	GetName() string
}