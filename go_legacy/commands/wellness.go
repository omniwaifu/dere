package commands

import (
	"fmt"
	"os"
	"path/filepath"
)

func (cg *CommandGenerator) generateWellnessCommand() error {
	filename := "dere-wellness.md"
	filepath := filepath.Join(cg.commandDir, filename)

	// Build MCP server list for the command
	mcpTools := ""
	if len(cg.mcpServers) > 0 {
		for _, server := range cg.mcpServers {
			if server == "activitywatch" {
				mcpTools = `
Available ActivityWatch tools:
- mcp__activitywatch__list_available_data: Discover what activity data is available
- mcp__activitywatch__get_events: Get detailed events from specific buckets`
			}
		}
	}

	content := fmt.Sprintf(`---
description: Start a wellness %s session
argument-hint:
---

## Context

You are in %s mode for a wellness check-in session.%s

## Your task

Begin a wellness check-in session:
1. Start with your personality-appropriate greeting
2. Ask how the user is feeling today
3. Guide them through a natural check-in conversation
4. If helpful, query their recent activity for context-aware observations
5. Extract wellness metrics at the end

Remember to maintain your personality traits while being therapeutic and supportive.
`, cg.mode, cg.mode, mcpTools)

	if err := os.WriteFile(filepath, []byte(content), 0644); err != nil {
		return fmt.Errorf("failed to write wellness command file %s: %w", filepath, err)
	}

	cg.createdFiles = append(cg.createdFiles, filepath)
	return nil
}

func (cg *CommandGenerator) SetMode(mode string) {
	cg.mode = mode
}

func (cg *CommandGenerator) SetMCPServers(servers []string) {
	cg.mcpServers = servers
}