package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

// ClaudeSession represents the JSON input from Claude
type ClaudeSession struct {
	SessionID string `json:"session_id"`
	Model     struct {
		ID          string `json:"id"`
		DisplayName string `json:"display_name"`
	} `json:"model"`
	CWD     string `json:"cwd"`
	Version string `json:"version"`
	Cost    struct {
		TotalCostUSD  float64 `json:"total_cost_usd"`
		TotalDuration int     `json:"total_duration_ms"`
	} `json:"cost"`
}

// ANSI color codes
const (
	Reset   = "\033[0m"
	Red     = "\033[31m"
	Green   = "\033[32m"
	Yellow  = "\033[33m"
	Blue    = "\033[34m"
	Magenta = "\033[35m"
	Cyan    = "\033[36m"
	Gray    = "\033[90m"
	White   = "\033[37m"
)

func main() {
	// Read Claude session data from stdin
	var session ClaudeSession
	decoder := json.NewDecoder(os.Stdin)
	if err := decoder.Decode(&session); err != nil {
		// If we can't parse session data, still show dere info
		showDereStatusOnly()
		return
	}

	// Get dere configuration from environment
	personality := os.Getenv("DERE_PERSONALITY")
	mcpServers := os.Getenv("DERE_MCP_SERVERS")
	context := os.Getenv("DERE_CONTEXT")
	outputStyle := os.Getenv("DERE_OUTPUT_STYLE")
	customPrompts := os.Getenv("DERE_CUSTOM_PROMPTS")
	sessionType := os.Getenv("DERE_SESSION_TYPE") // continue, resume, new

	// Build status line
	var parts []string

	// Personality with color
	if personality != "" && personality != "bare" {
		parts = append(parts, formatPersonality(personality))
	}

	// Model info
	if session.Model.ID != "" {
		parts = append(parts, formatModel(session.Model.ID))
	}

	// MCP servers
	if mcpServers != "" {
		parts = append(parts, formatMCPServers(mcpServers))
	}

	// Context awareness
	if context == "true" {
		parts = append(parts, Gray+"⊙"+Reset+" ctx")
	}

	// Session type
	if sessionType != "" && sessionType != "new" {
		parts = append(parts, formatSessionType(sessionType))
	}

	// Custom prompts
	if customPrompts != "" {
		parts = append(parts, Gray+"□"+Reset+" "+customPrompts)
	}

	// Output style
	if outputStyle != "" && outputStyle != "default" {
		parts = append(parts, Gray+"◈"+Reset+" "+outputStyle)
	}

	// Working directory (shortened)
	if session.CWD != "" {
		parts = append(parts, Gray+"▸"+Reset+" "+shortenPath(session.CWD))
	}

	// Join with separators
	if len(parts) > 0 {
		fmt.Print(strings.Join(parts, Gray+" │ "+Reset))
	}
}

func showDereStatusOnly() {
	personality := os.Getenv("DERE_PERSONALITY")
	if personality != "" && personality != "bare" {
		fmt.Print(formatPersonality(personality))
	} else {
		fmt.Print(Gray + "dere" + Reset)
	}
}

func formatPersonality(personality string) string {
	switch personality {
	case "tsun":
		return Red + "●" + Reset + " tsun"
	case "kuu":
		return Blue + "●" + Reset + " kuu"
	case "yan":
		return Magenta + "●" + Reset + " yan"
	case "dere":
		return Green + "●" + Reset + " dere"
	case "ero":
		return Yellow + "●" + Reset + " ero"
	default:
		// Handle combinations like "tsun+kuu"
		if strings.Contains(personality, "+") {
			return Gray + "●" + Reset + " " + personality
		}
		return Gray + "●" + Reset + " " + personality
	}
}

func formatModel(model string) string {
	// Extract model type from full model name
	modelLower := strings.ToLower(model)

	if strings.Contains(modelLower, "opus") {
		return Yellow + "◆" + Reset + " opus"
	} else if strings.Contains(modelLower, "sonnet") {
		return White + "◇" + Reset + " sonnet"
	} else if strings.Contains(modelLower, "haiku") {
		return Gray + "◦" + Reset + " haiku"
	} else {
		// Unknown model, show first part
		parts := strings.Split(model, "-")
		if len(parts) > 0 {
			return Gray + "◈" + Reset + " " + parts[0]
		}
		return Gray + "◈" + Reset + " model"
	}
}

func formatMCPServers(servers string) string {
	if servers == "" {
		return ""
	}

	// Count servers
	serverList := strings.Split(servers, ",")
	count := len(serverList)

	if count == 1 {
		// Show single server name
		serverName := strings.TrimSpace(serverList[0])
		return Cyan + "▪" + Reset + " " + serverName
	} else {
		// Show count for multiple servers
		return Cyan + "▪" + Reset + fmt.Sprintf(" %d", count)
	}
}

func formatSessionType(sessionType string) string {
	switch sessionType {
	case "continue":
		return Green + "↻" + Reset + " cont"
	case "resume":
		return Yellow + "↵" + Reset + " resume"
	default:
		return Gray + "●" + Reset + " " + sessionType
	}
}

func shortenPath(path string) string {
	// Get home directory for ~/ replacement
	home, _ := os.UserHomeDir()
	if home != "" && strings.HasPrefix(path, home) {
		path = "~" + strings.TrimPrefix(path, home)
	}

	// Limit length to keep status line reasonable
	if len(path) > 25 {
		// Show first and last parts
		parts := strings.Split(path, "/")
		if len(parts) > 3 {
			return parts[0] + "/.../" + parts[len(parts)-1]
		}
	}

	return path
}