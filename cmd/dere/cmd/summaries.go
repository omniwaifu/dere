package cmd

import (
	"fmt"
	"strings"
	"time"

	"dere/src/database"

	"github.com/spf13/cobra"
)

var (
	summariesLimit   int
	summariesProject string
	summariesDays    int
)

// summariesCmd represents the summaries command
var summariesCmd = &cobra.Command{
	Use:   "summaries",
	Short: "Manage and view session summaries",
	Long: `View and manage session summaries generated when Claude Code sessions end.

Examples:
  dere summaries list                 # List recent summaries
  dere summaries list --days=7        # Summaries from last 7 days
  dere summaries list --project=/path # Summaries from specific project
  dere summaries show <id>            # Show a specific summary`,
}

// summariesListCmd represents the summaries list command
var summariesListCmd = &cobra.Command{
	Use:   "list",
	Short: "List session summaries",
	RunE: func(cmd *cobra.Command, args []string) error {
		db, err := getDatabase()
		if err != nil {
			return err
		}
		defer db.Close()

		summaries, err := getSummaries(db)
		if err != nil {
			return err
		}

		if len(summaries) == 0 {
			fmt.Println("No session summaries found")
			return nil
		}

		fmt.Printf("Found %d session summaries:\n\n", len(summaries))

		for _, summary := range summaries {
			displaySummary(summary)
		}

		return nil
	},
}

// summariesShowCmd represents the summaries show command
var summariesShowCmd = &cobra.Command{
	Use:   "show <id>",
	Short: "Show a specific session summary",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		var summaryID int64
		if _, err := fmt.Sscanf(args[0], "%d", &summaryID); err != nil {
			return fmt.Errorf("invalid summary ID: %s", args[0])
		}

		db, err := getDatabase()
		if err != nil {
			return err
		}
		defer db.Close()

		summary, err := getSummaryByID(db, summaryID)
		if err != nil {
			return err
		}

		if summary == nil {
			fmt.Printf("Summary %d not found\n", summaryID)
			return nil
		}

		displaySummaryFull(*summary)
		return nil
	},
}

// summariesLatestCmd represents the summaries latest command
var summariesLatestCmd = &cobra.Command{
	Use:   "latest",
	Short: "Show the most recent session summary",
	RunE: func(cmd *cobra.Command, args []string) error {
		db, err := getDatabase()
		if err != nil {
			return err
		}
		defer db.Close()

		summary, err := getLatestSummary(db)
		if err != nil {
			return err
		}

		if summary == nil {
			fmt.Println("No session summaries found")
			return nil
		}

		displaySummaryFull(*summary)
		return nil
	},
}

// SessionSummary represents a session summary
type SessionSummary struct {
	ID               int64
	SessionID        int64
	SummaryType      string
	Summary          string
	KeyTopics        []string
	KeyEntities      []int64
	TaskStatus       string
	NextSteps        string
	ModelUsed        string
	ProcessingTimeMs int
	CreatedAt        time.Time
	// Joined data
	WorkingDir     string
	Personality    string
	SessionStarted time.Time
}

// getSummaries retrieves summaries from database with filtering
func getSummaries(db *database.TursoDB) ([]SessionSummary, error) {
	sqlDB := db.GetDB()

	query := `
		SELECT
			ss.id, ss.session_id, ss.summary_type, ss.summary,
			COALESCE(ss.key_topics, '') as key_topics, COALESCE(ss.key_entities, '') as key_entities, COALESCE(ss.task_status, '') as task_status, COALESCE(ss.next_steps, '') as next_steps,
			COALESCE(ss.model_used, '') as model_used, COALESCE(ss.processing_time_ms, 0) as processing_time_ms, ss.created_at,
			s.working_dir,
			COALESCE(GROUP_CONCAT(sp.personality_name), '') as personalities,
			s.start_time
		FROM session_summaries ss
		JOIN sessions s ON ss.session_id = s.id
		LEFT JOIN session_personalities sp ON s.id = sp.session_id
	`
	args := []interface{}{}

	var conditions []string

	// Filter by project
	if summariesProject != "" {
		conditions = append(conditions, "s.working_dir = ?")
		args = append(args, summariesProject)
	}

	// Filter by days
	if summariesDays > 0 {
		cutoff := time.Now().AddDate(0, 0, -summariesDays).Unix()
		conditions = append(conditions, "ss.created_at > datetime(?, 'unixepoch')")
		args = append(args, cutoff)
	}

	if len(conditions) > 0 {
		query += " WHERE " + strings.Join(conditions, " AND ")
	}

	query += " GROUP BY ss.id ORDER BY ss.created_at DESC LIMIT ?"
	args = append(args, summariesLimit)

	rows, err := sqlDB.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query summaries: %w", err)
	}
	defer rows.Close()

	var summaries []SessionSummary
	for rows.Next() {
		var summary SessionSummary
		var keyTopics, keyEntities string
		var personalities string
		var startTime int64

		err := rows.Scan(
			&summary.ID, &summary.SessionID, &summary.SummaryType, &summary.Summary,
			&keyTopics, &keyEntities, &summary.TaskStatus, &summary.NextSteps,
			&summary.ModelUsed, &summary.ProcessingTimeMs, &summary.CreatedAt,
			&summary.WorkingDir, &personalities, &startTime,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan summary: %w", err)
		}

		summary.Personality = personalities
		summary.SessionStarted = time.Unix(startTime, 0)

		// Parse JSON fields (simplified for now)
		// In production, would use json.Unmarshal

		summaries = append(summaries, summary)
	}

	return summaries, nil
}

// getSummaryByID retrieves a specific summary
func getSummaryByID(db *database.TursoDB, id int64) (*SessionSummary, error) {
	sqlDB := db.GetDB()

	query := `
		SELECT
			ss.id, ss.session_id, ss.summary_type, ss.summary,
			COALESCE(ss.key_topics, '') as key_topics, COALESCE(ss.key_entities, '') as key_entities, COALESCE(ss.task_status, '') as task_status, COALESCE(ss.next_steps, '') as next_steps,
			COALESCE(ss.model_used, '') as model_used, COALESCE(ss.processing_time_ms, 0) as processing_time_ms, ss.created_at,
			s.working_dir,
			COALESCE(GROUP_CONCAT(sp.personality_name), '') as personalities,
			s.start_time
		FROM session_summaries ss
		JOIN sessions s ON ss.session_id = s.id
		LEFT JOIN session_personalities sp ON s.id = sp.session_id
		WHERE ss.id = ?
		GROUP BY ss.id
	`

	var summary SessionSummary
	var keyTopics, keyEntities string
	var personalities string
	var startTime int64

	err := sqlDB.QueryRow(query, id).Scan(
		&summary.ID, &summary.SessionID, &summary.SummaryType, &summary.Summary,
		&keyTopics, &keyEntities, &summary.TaskStatus, &summary.NextSteps,
		&summary.ModelUsed, &summary.ProcessingTimeMs, &summary.CreatedAt,
		&summary.WorkingDir, &personalities, &startTime,
	)

	if err != nil {
		return nil, err
	}

	summary.Personality = personalities
	summary.SessionStarted = time.Unix(startTime, 0)

	return &summary, nil
}

// getLatestSummary retrieves the most recent summary
func getLatestSummary(db *database.TursoDB) (*SessionSummary, error) {
	sqlDB := db.GetDB()

	query := `
		SELECT id FROM session_summaries
		ORDER BY created_at DESC
		LIMIT 1
	`

	var id int64
	err := sqlDB.QueryRow(query).Scan(&id)
	if err != nil {
		return nil, err
	}

	return getSummaryByID(db, id)
}

// displaySummary shows a summary in list format
func displaySummary(summary SessionSummary) {
	duration := summary.CreatedAt.Sub(summary.SessionStarted)

	fmt.Printf("📝 Summary #%d (Session %d)\n", summary.ID, summary.SessionID)
	fmt.Printf("   📁 %s\n", summary.WorkingDir)
	fmt.Printf("   🎭 %s | ⏱️  %s | 📅 %s\n",
		summary.Personality,
		duration.Round(time.Minute),
		summary.CreatedAt.Format("Jan 2 15:04"))

	// Show first line of summary
	lines := strings.Split(summary.Summary, "\n")
	if len(lines) > 0 && lines[0] != "" {
		firstLine := lines[0]
		if len(firstLine) > 80 {
			firstLine = firstLine[:77] + "..."
		}
		fmt.Printf("   💭 %s\n", firstLine)
	}
	fmt.Println()
}

// displaySummaryFull shows a complete summary
func displaySummaryFull(summary SessionSummary) {
	duration := summary.CreatedAt.Sub(summary.SessionStarted)

	fmt.Printf("═══════════════════════════════════════════════════\n")
	fmt.Printf("📝 Session Summary #%d\n", summary.ID)
	fmt.Printf("═══════════════════════════════════════════════════\n\n")

	fmt.Printf("📁 Project: %s\n", summary.WorkingDir)
	fmt.Printf("🎭 Personality: %s\n", summary.Personality)
	fmt.Printf("📅 Session: %s - %s (%s)\n",
		summary.SessionStarted.Format("Jan 2 15:04"),
		summary.CreatedAt.Format("15:04"),
		duration.Round(time.Minute))
	fmt.Printf("🤖 Model: %s\n", summary.ModelUsed)
	fmt.Println()

	fmt.Println("Summary:")
	fmt.Println("────────────────────────────────────────")
	fmt.Println(summary.Summary)

	if summary.NextSteps != "" {
		fmt.Println("\nNext Steps:")
		fmt.Println("────────────────────────────────────────")
		fmt.Println(summary.NextSteps)
	}
}

func init() {
	rootCmd.AddCommand(summariesCmd)
	summariesCmd.AddCommand(summariesListCmd)
	summariesCmd.AddCommand(summariesShowCmd)
	summariesCmd.AddCommand(summariesLatestCmd)

	// Flags for list command
	summariesListCmd.Flags().IntVar(&summariesLimit, "limit", 10, "Number of summaries to show")
	summariesListCmd.Flags().StringVar(&summariesProject, "project", "", "Filter by project path")
	summariesListCmd.Flags().IntVar(&summariesDays, "days", 0, "Show summaries from last N days")

	// Flags for latest command
	summariesLatestCmd.Flags().StringVar(&summariesProject, "project", "", "Latest summary for specific project")
}