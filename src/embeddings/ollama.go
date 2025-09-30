package embeddings

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"dere/src/config"
)

// Package-level singleton HTTP client for optimal connection reuse
var (
	globalHTTPClient *http.Client
	clientOnce       sync.Once
)

type OllamaClient struct {
	baseURL        string
	model          string
	client         *http.Client
	lastHealthCheck time.Time
	isHealthy      bool
	healthMutex    sync.RWMutex
	ctx            context.Context // Add context for proper cancellation
	cancel         context.CancelFunc
	healthCheckDone chan struct{} // Signal for health check goroutine termination
}

type OllamaEmbedRequest struct {
	Model  string `json:"model"`
	Prompt string `json:"prompt"`
}

type OllamaEmbedResponse struct {
	Embedding []float32 `json:"embedding"`
}

type OllamaGenerateRequest struct {
	Model  string      `json:"model"`
	Prompt string      `json:"prompt"`
	Stream bool        `json:"stream"`
	Format interface{} `json:"format,omitempty"`
}

type OllamaGenerateResponse struct {
	Response string `json:"response"`
	Done     bool   `json:"done"`
}

// getHTTPClient returns the singleton HTTP client with optimized settings
func getHTTPClient() *http.Client {
	clientOnce.Do(func() {
		// Create transport with optimized connection pooling
		transport := &http.Transport{
			MaxIdleConns:        100,              // Increased for better reuse
			MaxIdleConnsPerHost: 50,               // Higher per-host connections
			MaxConnsPerHost:     50,               // Limit concurrent connections
			IdleConnTimeout:     90 * time.Second,
			DisableKeepAlives:   false,
			ForceAttemptHTTP2:   true, // Enable HTTP/2 when available
			DialContext: (&net.Dialer{
				Timeout:   10 * time.Second,
				KeepAlive: 30 * time.Second,
				DualStack: true, // Enable IPv4/IPv6
			}).DialContext,
			TLSHandshakeTimeout:   10 * time.Second,
			ExpectContinueTimeout: 1 * time.Second,
		}

		globalHTTPClient = &http.Client{
			Timeout:   60 * time.Second,
			Transport: transport,
		}
	})
	return globalHTTPClient
}

func NewOllamaClient(cfg *config.OllamaConfig) *OllamaClient {
	ctx, cancel := context.WithCancel(context.Background())

	client := &OllamaClient{
		baseURL:         cfg.URL,
		model:           cfg.EmbeddingModel,
		client:          getHTTPClient(), // Use singleton client
		isHealthy:       true, // Assume healthy initially
		ctx:             ctx,
		cancel:          cancel,
		healthCheckDone: make(chan struct{}),
	}

	// Start health check goroutine with proper lifecycle management
	go client.runHealthCheck()

	return client
}

// runHealthCheck runs periodic health checks in a goroutine
func (c *OllamaClient) runHealthCheck() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	defer close(c.healthCheckDone)

	// Do initial check
	c.checkHealth()

	for {
		select {
		case <-c.ctx.Done():
			return
		case <-ticker.C:
			c.checkHealth()
		}
	}
}

// Shutdown gracefully shuts down the client
func (c *OllamaClient) Shutdown() error {
	c.cancel() // Cancel context to stop goroutines

	// Wait for health check to complete
	select {
	case <-c.healthCheckDone:
	case <-time.After(1 * time.Second): // Timeout after 1 second
	}

	return nil
}

func (c *OllamaClient) GetEmbeddingModel() string {
	return c.model
}

func (c *OllamaClient) GetEmbedding(text string) ([]float32, error) {
	// Check health first
	if !c.ensureHealthy() {
		return nil, fmt.Errorf("Ollama server is not healthy")
	}

	reqBody := OllamaEmbedRequest{
		Model:  c.model,
		Prompt: text,
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	// Retry with exponential backoff
	maxRetries := 3
	baseDelay := time.Second

	for attempt := 0; attempt < maxRetries; attempt++ {
		req, err := http.NewRequestWithContext(c.ctx, "POST", c.baseURL+"/api/embeddings", bytes.NewBuffer(jsonData))
		if err != nil {
			return nil, fmt.Errorf("failed to create request: %w", err)
		}

		req.Header.Set("Content-Type", "application/json")

		resp, err := c.client.Do(req)
		if err != nil {
			// Check health and retry
			if !c.IsAvailable() {
				c.setHealthy(false)
			}
			if attempt < maxRetries-1 {
				delay := baseDelay * time.Duration(1<<uint(attempt))
				time.Sleep(delay)
				continue
			}
			return nil, fmt.Errorf("failed to send request: %w", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(resp.Body)
			if attempt < maxRetries-1 && resp.StatusCode >= 500 {
				delay := baseDelay * time.Duration(1<<uint(attempt))
				time.Sleep(delay)
				continue
			}
			return nil, fmt.Errorf("ollama API error (status %d): %s", resp.StatusCode, string(body))
		}

		body, err := io.ReadAll(resp.Body)
		if err != nil {
			return nil, fmt.Errorf("failed to read response: %w", err)
		}

		var embedResp OllamaEmbedResponse
		if err := json.Unmarshal(body, &embedResp); err != nil {
			return nil, fmt.Errorf("failed to unmarshal response: %w", err)
		}

		return embedResp.Embedding, nil
	}

	return nil, fmt.Errorf("failed after %d retries", maxRetries)
}

func (c *OllamaClient) Generate(prompt string) (string, error) {
	return c.GenerateWithModel(prompt, c.model, nil)
}

func (c *OllamaClient) GenerateWithModel(prompt, model string, schema interface{}) (string, error) {
	// Check health first
	if !c.ensureHealthy() {
		return "", fmt.Errorf("Ollama server is not healthy")
	}

	// Implement exponential backoff for retries
	maxRetries := 3
	baseDelay := time.Second

	for attempt := 0; attempt < maxRetries; attempt++ {
		response, err := c.tryGenerate(prompt, model, schema)

		if err == nil {
			return response, nil
		}

		// Check if server is still healthy
		if !c.IsAvailable() {
			c.setHealthy(false)
			if c.ensureHealthy() {
				continue
			}
		}

		// If not the last attempt, wait with exponential backoff
		if attempt < maxRetries-1 {
			delay := baseDelay * time.Duration(1<<uint(attempt))
			time.Sleep(delay)
		}
	}

	return "", fmt.Errorf("failed after %d retries", maxRetries)
}

// GetEntityExtractionSchema returns the JSON schema for entity extraction
func GetEntityExtractionSchema() map[string]interface{} {
	return map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"entities": map[string]interface{}{
				"type": "array",
				"items": map[string]interface{}{
					"type": "object",
					"properties": map[string]interface{}{
						"type":             map[string]interface{}{"type": "string"},
						"value":            map[string]interface{}{"type": "string"},
						"normalized_value": map[string]interface{}{"type": "string"},
						"confidence":       map[string]interface{}{"type": "number"},
					},
					"required": []string{"type", "value", "confidence"},
				},
			},
		},
		"required": []string{"entities"},
	}
}

func (c *OllamaClient) tryGenerate(prompt, model string, schema interface{}) (string, error) {
	reqBody := OllamaGenerateRequest{
		Model:  model,
		Prompt: prompt,
		Stream: false,
		Format: schema, // Use provided schema, or nil for free text
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(c.ctx, "POST", c.baseURL+"/api/generate", bytes.NewBuffer(jsonData))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("ollama API error (status %d): %s", resp.StatusCode, string(body))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read response: %w", err)
	}

	var genResp OllamaGenerateResponse
	if err := json.Unmarshal(body, &genResp); err != nil {
		return "", fmt.Errorf("failed to unmarshal response: %w", err)
	}

	return genResp.Response, nil
}

func (c *OllamaClient) IsAvailable() bool {
	resp, err := c.client.Get(c.baseURL + "/api/tags")
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return false
	}

	// Check if our model exists
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return false
	}

	var tagsResp struct {
		Models []struct {
			Name string `json:"name"`
		} `json:"models"`
	}

	if err := json.Unmarshal(body, &tagsResp); err != nil {
		return false
	}

	for _, model := range tagsResp.Models {
		if model.Name == c.model || model.Name == c.model+":latest" {
			return true
		}
	}

	return false
}

// checkHealth performs a health check on the Ollama server
func (c *OllamaClient) checkHealth() bool {
	resp, err := c.client.Get(c.baseURL + "/api/tags")
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	return resp.StatusCode == http.StatusOK
}

// setHealthy updates the health status
func (c *OllamaClient) setHealthy(healthy bool) {
	c.healthMutex.Lock()
	defer c.healthMutex.Unlock()
	c.isHealthy = healthy
	c.lastHealthCheck = time.Now()
}

// getHealthStatus returns current health status and when it was last checked
func (c *OllamaClient) getHealthStatus() (bool, time.Time) {
	c.healthMutex.RLock()
	defer c.healthMutex.RUnlock()
	return c.isHealthy, c.lastHealthCheck
}

// ensureHealthy checks if the server is healthy, attempting to restore if not
func (c *OllamaClient) ensureHealthy() bool {
	healthy, lastCheck := c.getHealthStatus()

	// If healthy and checked within last 30 seconds, assume still healthy
	if healthy && time.Since(lastCheck) < 30*time.Second {
		return true
	}

	// Perform health check
	if c.checkHealth() {
		c.setHealthy(true)
		return true
	}

	// Server is not healthy, try to recover
	c.setHealthy(false)

	// Wait a bit and retry
	time.Sleep(2 * time.Second)
	if c.checkHealth() {
		c.setHealthy(true)
		return true
	}

	return false
}

// PrewarmModel loads a model into memory before use
func (c *OllamaClient) PrewarmModel(modelName string) error {
	// Simple generate request to load the model
	reqBody := OllamaGenerateRequest{
		Model:  modelName,
		Prompt: "test",
		Stream: false,
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(c.ctx, "POST", c.baseURL+"/api/generate", bytes.NewBuffer(jsonData))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to prewarm model: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to prewarm model (status %d): %s", resp.StatusCode, string(body))
	}

	// Read and discard the response
	_, _ = io.ReadAll(resp.Body)
	return nil
}

func (c *OllamaClient) GetModelContextLength(modelName string) (int, error) {
	reqBody := map[string]string{"name": modelName}
	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return 0, fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequest("POST", c.baseURL+"/api/show", bytes.NewBuffer(jsonData))
	if err != nil {
		return 0, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return 0, fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return 0, fmt.Errorf("ollama API error (status %d): %s", resp.StatusCode, string(body))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return 0, fmt.Errorf("failed to read response: %w", err)
	}

	var showResp struct {
		ModelInfo map[string]interface{} `json:"model_info"`
	}

	if err := json.Unmarshal(body, &showResp); err != nil {
		return 0, fmt.Errorf("failed to unmarshal response: %w", err)
	}

	// Look for context_length in model_info
	// The key format varies by model family (e.g., "gemma3n.context_length", "llama.context_length")
	for key, value := range showResp.ModelInfo {
		if strings.HasSuffix(key, ".context_length") {
			if contextLength, ok := value.(float64); ok {
				return int(contextLength), nil
			}
		}
	}

	// Fallback to reasonable default if not found
	return 2048, nil
}
