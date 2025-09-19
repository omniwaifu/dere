package cmd

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
)

var (
	statsDays    int
	statsProject string
)

// statsCmd represents the stats command
var statsCmd = &cobra.Command{
	Use:   "stats",
	Short: "Show usage statistics",
	Long: `Show usage statistics and patterns from conversation history.

Examples:
  dere stats                    # Overall stats
  dere stats --days=7          # Last 7 days
  dere stats --project=.       # Current project only`,
	RunE: func(cmd *cobra.Command, args []string) error {
		db, err := getDatabase()
		if err != nil {
			return err
		}
		defer db.Close()

		// Get current working directory for project filtering
		var projectPath string
		if statsProject != "" {
			if statsProject == "." {
				projectPath, err = os.Getwd()
				if err != nil {
					return fmt.Errorf("failed to get current directory: %w", err)
				}
			} else {
				projectPath, err = filepath.Abs(statsProject)
				if err != nil {
					return fmt.Errorf("invalid project path: %w", err)
				}
			}
		}

		stats, err := db.GetStats(statsDays, projectPath)
		if err != nil {
			return err
		}

		// Display stats
		if projectPath != "" {
			fmt.Printf("Statistics for project: %s\n", projectPath)
		} else {
			fmt.Println("Overall statistics")
		}

		if statsDays > 0 {
			fmt.Printf("(Last %d days)\n", statsDays)
		}
		fmt.Println()

		fmt.Printf("Total sessions: %d\n", stats.TotalSessions)
		fmt.Printf("Total conversations: %d\n", stats.TotalConversations)
		fmt.Printf("Average conversations per session: %.1f\n", stats.AvgConversationsPerSession)
		fmt.Println()

		if len(stats.TopPersonalities) > 0 {
			fmt.Println("Most used personalities:")
			for i, p := range stats.TopPersonalities {
				fmt.Printf("  %d. %s (%d sessions)\n", i+1, p.Name, p.Count)
			}
			fmt.Println()
		}

		if len(stats.TopProjects) > 0 {
			fmt.Println("Most active projects:")
			for i, p := range stats.TopProjects {
				fmt.Printf("  %d. %s (%d sessions)\n", i+1, p.Name, p.Count)
			}
			fmt.Println()
		}

		if len(stats.ActivityByDay) > 0 {
			fmt.Println("Activity by day:")
			for _, day := range stats.ActivityByDay {
				fmt.Printf("  %s: %d sessions\n", day.Date, day.Sessions)
			}
		}

		return nil
	},
}

func init() {
	rootCmd.AddCommand(statsCmd)

	// Flags
	statsCmd.Flags().IntVar(&statsDays, "days", 0, "Limit to recent days (0 = all time)")
	statsCmd.Flags().StringVar(&statsProject, "project", "", "Filter by project path (use '.' for current)")
}