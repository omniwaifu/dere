package commands

import (
	"fmt"
	"os"
	"path/filepath"
)

type CommandGenerator struct {
	personalities []string
	commandDir    string
	createdFiles  []string
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
	return &CommandGenerator{
		personalities: personalities,
		commandDir:    ".claude/commands",
		createdFiles:  make([]string, 0),
	}
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
	
	return nil
}

func (cg *CommandGenerator) generatePersonalityCommands(personality string) error {
	commands := getPersonalityCommands(personality)
	
	for cmdName, template := range commands.Commands {
		filename := fmt.Sprintf("%s-%s.md", personality, cmdName)
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
	for _, file := range cg.createdFiles {
		os.Remove(file) // Ignore errors
	}
	
	// Remove the commands directory if it's empty
	if entries, err := os.ReadDir(cg.commandDir); err == nil && len(entries) == 0 {
		os.Remove(cg.commandDir)
	}
	
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