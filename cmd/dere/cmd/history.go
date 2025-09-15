package cmd

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"dere/src/config"
	"dere/src/database"
	"dere/src/embeddings"
	
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

var (
	historyLimit int
	historyDays  int
	globalSearch bool
)

// historyCmd represents the history command
var historyCmd = &cobra.Command{
	Use:   "history",
	Short: "Manage conversation history",
	Long: `Manage conversation history stored in the database.
	
Examples:
  dere history list
  dere history search "python debugging"
  dere history show <session-id>
  dere history clean --days=30`,
}

// historyListCmd represents the history list command
var historyListCmd = &cobra.Command{
	Use:   "list",
	Short: "List recent conversations",
	RunE: func(cmd *cobra.Command, args []string) error {
		db, err := getDatabase()
		if err != nil {
			return err
		}
		defer db.Close()
		
		// For now, we'll just show a message since we need to implement
		// a method to list all sessions (not just by session ID)
		fmt.Println("Recent conversations:")
		fmt.Println("(Feature coming soon - database methods need updating)")
		
		// TODO: Add ListAllSessions method to database
		// conversations, err := db.ListAllSessions(historyLimit)
		// if err != nil {
		//     return err
		// }
		//
		// for _, conv := range conversations {
		//     fmt.Printf("[%s] %s - %s\n", 
		//         conv.CreatedAt.Format("2006-01-02 15:04"),
		//         conv.Personality,
		//         truncate(conv.Prompt, 50))
		// }
		
		return nil
	},
}

// historySearchCmd represents the history search command
var historySearchCmd = &cobra.Command{
	Use:   "search <query>",
	Short: "Search conversations using embeddings",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		query := args[0]
		
		// Check if Ollama is configured
		if !viper.GetBool("ollama.enabled") {
			return fmt.Errorf("Ollama is not enabled. Set ollama.enabled=true in config")
		}
		
		// Get Ollama client
		ollamaURL := viper.GetString("ollama.url")
		model := viper.GetString("ollama.embedding_model")
		if ollamaURL == "" || model == "" {
			return fmt.Errorf("Ollama not configured. Run: dere config set ollama.url <url>")
		}
		
		// Create config for Ollama client
		ollamaConfig := &config.OllamaConfig{
			Enabled:        true,
			URL:            ollamaURL,
			EmbeddingModel: model,
		}
		
		ollama := embeddings.NewOllamaClient(ollamaConfig)
		
		// Generate embedding for query
		embedding, err := ollama.GetEmbedding(query)
		if err != nil {
			return fmt.Errorf("failed to generate embedding: %w", err)
		}
		
		// Search database
		db, err := getDatabase()
		if err != nil {
			return err
		}
		defer db.Close()
		
		// Use project-aware search by default
		var results []database.Conversation
		if globalSearch {
			results, err = db.SearchSimilar(embedding, historyLimit)
			if err != nil {
				return fmt.Errorf("search failed: %w", err)
			}
		} else {
			// Get current working directory for project filtering
			cwd, err := os.Getwd()
			if err != nil {
				return fmt.Errorf("failed to get current directory: %w", err)
			}
			
			results, err = db.SearchSimilarInProject(embedding, cwd, historyLimit)
			if err != nil {
				return fmt.Errorf("search failed: %w", err)
			}
			
			if len(results) == 0 {
				fmt.Printf("No matching conversations found in project: %s\n", cwd)
				fmt.Println("Use --global to search across all projects")
				return nil
			}
		}
		
		if len(results) == 0 {
			fmt.Println("No matching conversations found")
			return nil
		}
		
		fmt.Printf("Found %d matching conversations:\n\n", len(results))
		for i, conv := range results {
			fmt.Printf("%d. [%s] Session: %s\n", i+1,
				time.Unix(conv.Timestamp, 0).Format("2006-01-02 15:04"),
				conv.SessionID[:8])
			if globalSearch && conv.ProjectPath != "" {
				fmt.Printf("   Project: %s\n", conv.ProjectPath)
			}
			fmt.Printf("   Personality: %s\n", conv.Personality)
			fmt.Printf("   Prompt: %s\n", truncate(conv.Prompt, 100))
			fmt.Println()
		}
		
		return nil
	},
}

// historyShowCmd represents the history show command
var historyShowCmd = &cobra.Command{
	Use:   "show <session-id>",
	Short: "Display a specific conversation session",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		sessionID := args[0]
		
		db, err := getDatabase()
		if err != nil {
			return err
		}
		defer db.Close()
		
		conversations, err := db.GetRecentConversations(sessionID, 100)
		if err != nil {
			return fmt.Errorf("failed to get conversations: %w", err)
		}
		
		if len(conversations) == 0 {
			fmt.Printf("No conversations found for session %s\n", sessionID)
			return nil
		}
		
		fmt.Printf("Session: %s\n", sessionID)
		fmt.Printf("Personality: %s\n\n", conversations[0].Personality)
		
		for _, conv := range conversations {
			fmt.Printf("[%s] %s\n\n",
				time.Unix(conv.Timestamp, 0).Format("15:04:05"),
				conv.Prompt)
		}
		
		return nil
	},
}

// historyCleanCmd represents the history clean command
var historyCleanCmd = &cobra.Command{
	Use:   "clean",
	Short: "Remove old conversation history",
	RunE: func(cmd *cobra.Command, args []string) error {
		if historyDays <= 0 {
			return fmt.Errorf("--days must be greater than 0")
		}
		
		// TODO: Implement cleanup in database
		fmt.Printf("Would clean conversations older than %d days\n", historyDays)
		fmt.Println("(Feature coming soon - database methods need updating)")
		
		// db, err := getDatabase()
		// if err != nil {
		//     return err
		// }
		// defer db.Close()
		//
		// cutoff := time.Now().AddDate(0, 0, -historyDays)
		// count, err := db.CleanupOldSessions(cutoff)
		// if err != nil {
		//     return err
		// }
		//
		// fmt.Printf("Removed %d old conversations\n", count)
		
		return nil
	},
}

// getDatabase returns a database connection
func getDatabase() (*database.TursoDB, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	
	dbPath := filepath.Join(home, ".local", "share", "dere", "conversations.db")
	return database.NewTursoDB(dbPath)
}

// truncate truncates a string to the specified length
func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	if maxLen <= 3 {
		return "..."
	}
	return s[:maxLen-3] + "..."
}

func init() {
	rootCmd.AddCommand(historyCmd)
	historyCmd.AddCommand(historyListCmd)
	historyCmd.AddCommand(historySearchCmd)
	historyCmd.AddCommand(historyShowCmd)
	historyCmd.AddCommand(historyCleanCmd)
	
	// Flags
	historyListCmd.Flags().IntVar(&historyLimit, "limit", 10, "Number of conversations to show")
	historySearchCmd.Flags().IntVar(&historyLimit, "limit", 5, "Number of results to show")
	historySearchCmd.Flags().BoolVar(&globalSearch, "global", false, "Search across all projects (default: current project only)")
	historyCleanCmd.Flags().IntVar(&historyDays, "days", 30, "Remove conversations older than this many days")
}