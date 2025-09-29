package commands

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type CommandGenerator struct {
	personalities []string
	commandDir    string
	createdFiles  []string
	trackingFile  string
	mode          string  // Wellness mode if any
	mcpServers    []string // MCP servers if any
}

type CleanupTracker struct {
	PID          int       `json:"pid"`
	CommandDir   string    `json:"command_dir"`
	CreatedFiles []string  `json:"created_files"`
	Timestamp    time.Time `json:"timestamp"`
}

func NewCommandGenerator(personalities []string) *CommandGenerator {
	homeDir, _ := os.UserHomeDir()
	globalCommandDir := filepath.Join(homeDir, ".claude", "commands")
	pid := os.Getpid()
	trackingFile := filepath.Join(os.TempDir(), fmt.Sprintf("dere-commands-%d.json", pid))

	cg := &CommandGenerator{
		personalities: personalities,
		commandDir:    globalCommandDir,
		createdFiles:  make([]string, 0),
		trackingFile:  trackingFile,
	}

	// Clean up any orphaned dere-* files from previous runs on startup
	cg.cleanupOrphanedFiles()

	return cg
}

// cleanupOrphanedFiles removes dere-* command files from crashed/killed sessions
func (cg *CommandGenerator) cleanupOrphanedFiles() {
	// Check for global commands directory
	if _, err := os.Stat(cg.commandDir); err == nil {
		// Look for tracking files in temp
		tempDir := os.TempDir()
		matches, _ := filepath.Glob(filepath.Join(tempDir, "dere-commands-*.json"))
		
		for _, trackingFile := range matches {
			// Try to load the tracking file
			data, err := os.ReadFile(trackingFile)
			if err != nil {
				continue
			}
			
			var tracker CleanupTracker
			if err := json.Unmarshal(data, &tracker); err != nil {
				continue
			}
			
			// Check if process is still running (Unix-specific)
			if !isProcessRunning(tracker.PID) {
				// Process is dead, clean up its files
				for _, file := range tracker.CreatedFiles {
					os.Remove(file)
				}
				
				// Remove the tracking file
				os.Remove(trackingFile)
			}
		}
		
		// Also check for orphaned dere-*.md files in command directory
		// if they're older than 1 hour (likely from crashed sessions)
		if entries, err := os.ReadDir(cg.commandDir); err == nil {
			now := time.Now()
			for _, entry := range entries {
				if strings.HasPrefix(entry.Name(), "dere-") && filepath.Ext(entry.Name()) == ".md" {
					filePath := filepath.Join(cg.commandDir, entry.Name())
					if info, err := os.Stat(filePath); err == nil {
						if now.Sub(info.ModTime()) > time.Hour {
							os.Remove(filePath)
						}
					}
				}
			}
		}
	}
}

// isProcessRunning checks if a process with given PID is still running
func isProcessRunning(pid int) bool {
	// Unix-specific: Check if we can send signal 0 (no-op) to the process
	process, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	err = process.Signal(os.Signal(nil))
	return err == nil
}

func (cg *CommandGenerator) Generate() error {
	// Create commands directory
	if err := os.MkdirAll(cg.commandDir, 0755); err != nil {
		return fmt.Errorf("failed to create commands directory: %w", err)
	}

	// Generate wellness command if in wellness mode
	if cg.mode != "" {
		if err := cg.generateWellnessCommand(); err != nil {
			return fmt.Errorf("failed to generate wellness command: %w", err)
		}
	}

	// Write tracking file for crash recovery
	if len(cg.createdFiles) > 0 {
		tracker := CleanupTracker{
			PID:          os.Getpid(),
			CommandDir:   cg.commandDir,
			CreatedFiles: cg.createdFiles,
			Timestamp:    time.Now(),
		}

		data, err := json.Marshal(tracker)
		if err == nil {
			os.WriteFile(cg.trackingFile, data, 0644)
		}
	}

	return nil
}

func (cg *CommandGenerator) Cleanup() error {
	// Clean up created files (only our dere-* files)
	for _, file := range cg.createdFiles {
		os.Remove(file) // Ignore errors
	}

	// Never remove the global commands directory (it might have user's own commands)

	// Remove tracking file since we're cleaning up properly
	os.Remove(cg.trackingFile)

	return nil
}