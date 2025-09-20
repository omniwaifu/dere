package embeddings

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"strings"
	"time"

	"dere/src/config"
)

type OllamaClient struct {
	baseURL string
	model   string
	client  *http.Client
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

func NewOllamaClient(cfg *config.OllamaConfig) *OllamaClient {
	return &OllamaClient{
		baseURL: cfg.URL,
		model:   cfg.EmbeddingModel,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (c *OllamaClient) GetEmbedding(text string) ([]float32, error) {
	reqBody := OllamaEmbedRequest{
		Model:  c.model,
		Prompt: text,
	}
	
	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}
	
	req, err := http.NewRequest("POST", c.baseURL+"/api/embeddings", bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	
	req.Header.Set("Content-Type", "application/json")
	
	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
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

func (c *OllamaClient) Generate(prompt string) (string, error) {
	return c.GenerateWithModel(prompt, c.model, nil)
}

func (c *OllamaClient) GenerateWithModel(prompt, model string, schema interface{}) (string, error) {
	// Try normal HTTP call first
	response, err := c.tryGenerate(prompt, model, schema)
	if err != nil && strings.Contains(err.Error(), "model runner has unexpectedly stopped") {
		// Model conflict - stop it and retry
		if stopErr := c.stopModel(model); stopErr == nil {
			time.Sleep(2 * time.Second)
			return c.tryGenerate(prompt, model, schema)
		}
	}
	return response, err
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

	req, err := http.NewRequest("POST", c.baseURL+"/api/generate", bytes.NewBuffer(jsonData))
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

func (c *OllamaClient) stopModel(model string) error {
	// Extract hostname from baseURL (e.g., "http://192.168.1.8:11434" -> "192.168.1.8")
	hostname := strings.TrimPrefix(c.baseURL, "http://")
	hostname = strings.TrimPrefix(hostname, "https://")
	hostname = strings.Split(hostname, ":")[0]

	// If it's localhost/127.0.0.1, run locally, otherwise SSH
	var cmd *exec.Cmd
	if hostname == "localhost" || hostname == "127.0.0.1" {
		cmd = exec.Command("ollama", "stop", model)
	} else {
		// SSH to remote host - assuming hostname is "macbook" or similar
		if hostname == "192.168.1.8" {
			cmd = exec.Command("ssh", "macbook", "/opt/homebrew/bin/ollama", "stop", model)
		} else {
			cmd = exec.Command("ssh", hostname, "ollama", "stop", model)
		}
	}

	err := cmd.Run()
	if err != nil {
		return fmt.Errorf("failed to stop model %s: %w", model, err)
	}

	return nil
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
