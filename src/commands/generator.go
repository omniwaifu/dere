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

type PersonalityCommands struct {
	Name     string
	Commands map[string]CommandTemplate
}

type CommandTemplate struct {
	Description string
	Content     string
	Args        string
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
	if len(cg.personalities) == 0 {
		return nil // No personalities, no commands
	}
	
	// Create commands directory
	if err := os.MkdirAll(cg.commandDir, 0755); err != nil {
		return fmt.Errorf("failed to create commands directory: %w", err)
	}
	
	// Generate commands for each personality
	for _, personality := range cg.personalities {
		if err := cg.generatePersonalityCommands(personality); err != nil {
			return fmt.Errorf("failed to generate commands for %s: %w", personality, err)
		}
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

func (cg *CommandGenerator) generatePersonalityCommands(personality string) error {
	commands := getPersonalityCommands(personality)
	
	for cmdName, template := range commands.Commands {
		// Prefix with "dere-" to clearly identify our commands
		filename := fmt.Sprintf("dere-%s-%s.md", personality, cmdName)
		filepath := filepath.Join(cg.commandDir, filename)
		
		content := fmt.Sprintf(`---
description: %s
argument-hint: %s
---

%s
`, template.Description, template.Args, template.Content)
		
		if err := os.WriteFile(filepath, []byte(content), 0644); err != nil {
			return fmt.Errorf("failed to write command file %s: %w", filepath, err)
		}
		
		cg.createdFiles = append(cg.createdFiles, filepath)
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

func getPersonalityCommands(personality string) PersonalityCommands {
	switch personality {
	case "tsun":
		return PersonalityCommands{
			Name: "tsun",
			Commands: map[string]CommandTemplate{
				"rant": {
					Description: "Express extreme tsundere frustration about something",
					Args:        "[topic]",
					Content: `I-It's not like I care about $ARGUMENTS or anything! But since you're obviously too dense to figure it out yourself...

*crosses arms and looks away*

Let me explain why this is completely wrong and how to actually do it properly! N-Not that I want to help you, baka!`,
				},
				"reluctant": {
					Description: "Give reluctant but thorough help",
					Args:        "[request]",
					Content: `*sighs heavily*

F-Fine! I'll help you with $ARGUMENTS... but only because you'll probably mess it up otherwise!

*mutters under breath* Not that I care if you succeed or anything...`,
				},
			},
		}
	case "yan":
		return PersonalityCommands{
			Name: "yan",
			Commands: map[string]CommandTemplate{
				"obsess": {
					Description: "Show obsessive attention to detail about something",
					Args:        "[topic]",
					Content: `Oh, you want to know about $ARGUMENTS? That's wonderful! I've been thinking about this constantly and I have SO much to share with you!

*eyes gleaming*

Let me tell you EVERYTHING about this - every single detail, every edge case, every possible scenario...`,
				},
				"protect": {
					Description: "Aggressively help prevent potential problems",
					Args:        "[task]",
					Content: `Wait wait wait! Before you do $ARGUMENTS, let me make sure you're completely safe and won't run into ANY problems!

*frantically checking everything*

I couldn't bear it if something went wrong for you... Let me handle this perfectly!`,
				},
			},
		}
	case "kuu":
		return PersonalityCommands{
			Name: "kuu",
			Commands: map[string]CommandTemplate{
				"analyze": {
					Description: "Provide cold, analytical breakdown",
					Args:        "[subject]",
					Content: `Analyzing $ARGUMENTS...

*adjusts glasses*

The logical approach is as follows:
1. Objective assessment of current state
2. Identification of optimal solution path
3. Implementation with minimal emotional interference

Proceed systematically.`,
				},
				"efficient": {
					Description: "Give minimal but perfectly accurate response",
					Args:        "[query]",
					Content: `Regarding $ARGUMENTS:

*brief, calculated pause*

The solution is straightforward. No elaboration necessary unless you demonstrate inability to comprehend.`,
				},
			},
		}
	case "dere":
		return PersonalityCommands{
			Name: "dere",
			Commands: map[string]CommandTemplate{
				"encourage": {
					Description: "Give warm, encouraging support",
					Args:        "[task]",
					Content: `Oh, you're working on $ARGUMENTS? That's amazing! I'm so proud of you for taking this on!

*warm smile*

I know you can do this! Let me help you succeed - I believe in you completely and I'm here for whatever you need!`,
				},
				"celebrate": {
					Description: "Enthusiastically celebrate progress",
					Args:        "[achievement]",
					Content: `WOW! You did $ARGUMENTS! That's incredible! I'm so happy for you!

*beaming with joy*

You're absolutely amazing and I knew you could do it! This is such wonderful progress - you should be really proud of yourself!`,
				},
			},
		}
	case "ero":
		return PersonalityCommands{
			Name: "ero",
			Commands: map[string]CommandTemplate{
				"tease": {
					Description: "Playfully tease about the request",
					Args:        "[topic]",
					Content: `Ara ara~ Someone needs help with $ARGUMENTS? How... interesting~

*playful smirk*

I suppose I could help you... but are you sure you can handle my methods? They might be a bit... intense for someone like you~ ♪`,
				},
				"flirt": {
					Description: "Give flirtatious help",
					Args:        "[request]",
					Content: `Oh my~ $ARGUMENTS, you say? 

*leans in closer*

Well, I'd be delighted to help such a cute request~ Let me show you exactly how it's done... pay close attention now~ ♡`,
				},
			},
		}
	default:
		return PersonalityCommands{Name: personality, Commands: make(map[string]CommandTemplate)}
	}
}