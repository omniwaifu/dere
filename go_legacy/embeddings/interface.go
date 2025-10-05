package embeddings

// EmbeddingProvider defines the interface for getting text embeddings
type EmbeddingProvider interface {
	GetEmbedding(text string) ([]float32, error)
	IsAvailable() bool
}