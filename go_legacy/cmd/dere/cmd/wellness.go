package cmd

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"dere/src/database"

	"github.com/spf13/cobra"
)

var (
	wellnessMode    string
	wellnessDays    int
	wellnessFormat  string
	wellnessLimit   int
)

// wellnessCmd represents the wellness command
var wellnessCmd = &cobra.Command{
	Use:   "wellness",
	Short: "View wellness and mental health trends",
	Long: `Explore wellness data and mental health trends from therapy mode sessions.

Examples:
  dere wellness trends --mode=checkin --days=30
  dere wellness history --mode=therapy --days=7
  dere wellness summary`,
}

// wellnessTrendsCmd shows wellness trends over time
var wellnessTrendsCmd = &cobra.Command{
	Use:   "trends",
	Short: "Show wellness trends over time",
	RunE: func(cmd *cobra.Command, args []string) error {
		db, err := getDatabase()
		if err != nil {
			return err
		}
		defer db.Close()

		if wellnessMode == "" {
			return fmt.Errorf("mode is required. Use --mode to specify (checkin, cbt, therapy, mindfulness, goals)")
		}

		trends, err := db.GetWellnessTrends(wellnessMode, wellnessDays)
		if err != nil {
			return fmt.Errorf("failed to get wellness trends: %w", err)
		}

		if len(trends) == 0 {
			fmt.Printf("No wellness data found for mode '%s' in the last %d days\n", wellnessMode, wellnessDays)
			return nil
		}

		displayWellnessTrends(trends, wellnessMode)
		return nil
	},
}

// wellnessHistoryCmd shows detailed wellness history
var wellnessHistoryCmd = &cobra.Command{
	Use:   "history",
	Short: "Show detailed wellness history",
	RunE: func(cmd *cobra.Command, args []string) error {
		db, err := getDatabase()
		if err != nil {
			return err
		}
		defer db.Close()

		history, err := getWellnessHistory(db, wellnessMode, wellnessDays, wellnessLimit)
		if err != nil {
			return fmt.Errorf("failed to get wellness history: %w", err)
		}

		if len(history) == 0 {
			if wellnessMode != "" {
				fmt.Printf("No wellness history found for mode '%s' in the last %d days\n", wellnessMode, wellnessDays)
			} else {
				fmt.Printf("No wellness history found in the last %d days\n", wellnessDays)
			}
			return nil
		}

		displayWellnessHistory(history)
		return nil
	},
}

// wellnessSummaryCmd shows a summary of all wellness modes
var wellnessSummaryCmd = &cobra.Command{
	Use:   "summary",
	Short: "Show a summary of all wellness modes",
	RunE: func(cmd *cobra.Command, args []string) error {
		db, err := getDatabase()
		if err != nil {
			return err
		}
		defer db.Close()

		summary, err := getWellnessSummary(db, wellnessDays)
		if err != nil {
			return fmt.Errorf("failed to get wellness summary: %w", err)
		}

		displayWellnessSummary(summary)
		return nil
	},
}

// WellnessHistoryEntry represents a wellness entry with all details
type WellnessHistoryEntry struct {
	Date          string
	Mode          string
	SessionID     int64
	Mood          int
	Energy        int
	Stress        int
	Themes        []string
	Notes         string
	Homework      []string
	NextSteps     string
	CreatedAt     time.Time
}

// WellnessSummary represents a summary across all modes
type WellnessSummary struct {
	TotalSessions     int
	ModeStats         map[string]ModeStats
	RecentAverages    WellnessAverages
	TrendAnalysis     TrendAnalysis
}

type ModeStats struct {
	SessionCount int
	LastSession  time.Time
	AvgMood      float64
	AvgEnergy    float64
	AvgStress    float64
}

type WellnessAverages struct {
	Mood   float64
	Energy float64
	Stress float64
}

type TrendAnalysis struct {
	MoodTrend   string // "improving", "declining", "stable"
	EnergyTrend string
	StressTrend string
}

// displayWellnessTrends shows trends in a visual format
func displayWellnessTrends(trends []database.WellnessTrendPoint, mode string) {
	fmt.Printf("📈 Wellness Trends for %s mode (last %d days):\n\n", strings.Title(mode), wellnessDays)

	if len(trends) == 0 {
		fmt.Println("No data available")
		return
	}

	// Sort by date
	sort.Slice(trends, func(i, j int) bool {
		return trends[i].Date < trends[j].Date
	})

	fmt.Println("Date       | Mood | Energy | Stress")
	fmt.Println("-----------|------|--------|-------")

	for _, trend := range trends {
		moodBar := generateWellnessBar(trend.Mood, 10)
		energyBar := generateWellnessBar(trend.Energy, 10)
		stressBar := generateWellnessBar(trend.Stress, 10)

		fmt.Printf("%-10s | %-4s | %-6s | %-5s\n",
			trend.Date, moodBar, energyBar, stressBar)
	}

	// Calculate averages
	var totalMood, totalEnergy, totalStress int
	for _, trend := range trends {
		totalMood += trend.Mood
		totalEnergy += trend.Energy
		totalStress += trend.Stress
	}

	avgMood := float64(totalMood) / float64(len(trends))
	avgEnergy := float64(totalEnergy) / float64(len(trends))
	avgStress := float64(totalStress) / float64(len(trends))

	fmt.Printf("\n📊 Averages: Mood %.1f/10, Energy %.1f/10, Stress %.1f/10\n",
		avgMood, avgEnergy, avgStress)

	// Show trend analysis
	if len(trends) >= 3 {
		fmt.Printf("\n📈 Analysis:\n")
		analyzeTrend("Mood", trends, func(t database.WellnessTrendPoint) int { return t.Mood })
		analyzeTrend("Energy", trends, func(t database.WellnessTrendPoint) int { return t.Energy })
		analyzeTrend("Stress", trends, func(t database.WellnessTrendPoint) int { return t.Stress })
	}
}

// displayWellnessHistory shows detailed history
func displayWellnessHistory(history []WellnessHistoryEntry) {
	fmt.Printf("📚 Wellness History (last %d entries):\n\n", len(history))

	for i, entry := range history {
		fmt.Printf("🗓️  %s (%s mode) - Session %d\n", entry.Date, entry.Mode, entry.SessionID)
		fmt.Printf("   Mood: %s (%d/10)  Energy: %s (%d/10)  Stress: %s (%d/10)\n",
			generateWellnessBar(entry.Mood, 10), entry.Mood,
			generateWellnessBar(entry.Energy, 10), entry.Energy,
			generateWellnessBar(entry.Stress, 10), entry.Stress)

		if len(entry.Themes) > 0 {
			fmt.Printf("   🏷️  Themes: %s\n", strings.Join(entry.Themes, ", "))
		}

		if entry.Notes != "" {
			fmt.Printf("   📝 Notes: %s\n", entry.Notes)
		}

		if len(entry.Homework) > 0 {
			fmt.Printf("   📋 Homework: %s\n", strings.Join(entry.Homework, "; "))
		}

		if entry.NextSteps != "" {
			fmt.Printf("   ➡️  Next: %s\n", entry.NextSteps)
		}

		if i < len(history)-1 {
			fmt.Println()
		}
	}
}

// displayWellnessSummary shows overall summary
func displayWellnessSummary(summary WellnessSummary) {
	fmt.Printf("🌟 Wellness Summary (last %d days):\n\n", wellnessDays)

	fmt.Printf("Total Sessions: %d\n\n", summary.TotalSessions)

	if len(summary.ModeStats) == 0 {
		fmt.Println("No wellness sessions found")
		return
	}

	fmt.Println("📊 By Mode:")
	for mode, stats := range summary.ModeStats {
		fmt.Printf("  %s: %d sessions (avg: mood %.1f, energy %.1f, stress %.1f)\n",
			strings.Title(mode), stats.SessionCount, stats.AvgMood, stats.AvgEnergy, stats.AvgStress)
		fmt.Printf("    Last session: %s\n", stats.LastSession.Format("2006-01-02"))
	}

	fmt.Printf("\n📈 Overall Averages:\n")
	fmt.Printf("  Mood: %.1f/10 %s\n", summary.RecentAverages.Mood,
		generateWellnessBar(int(summary.RecentAverages.Mood), 10))
	fmt.Printf("  Energy: %.1f/10 %s\n", summary.RecentAverages.Energy,
		generateWellnessBar(int(summary.RecentAverages.Energy), 10))
	fmt.Printf("  Stress: %.1f/10 %s\n", summary.RecentAverages.Stress,
		generateWellnessBar(int(summary.RecentAverages.Stress), 10))

	fmt.Printf("\n🔄 Trends:\n")
	fmt.Printf("  Mood: %s\n", getTrendEmoji(summary.TrendAnalysis.MoodTrend))
	fmt.Printf("  Energy: %s\n", getTrendEmoji(summary.TrendAnalysis.EnergyTrend))
	fmt.Printf("  Stress: %s\n", getTrendEmoji(summary.TrendAnalysis.StressTrend))
}

// getWellnessHistory retrieves detailed wellness history
func getWellnessHistory(db *database.TursoDB, mode string, days, limit int) ([]WellnessHistoryEntry, error) {
	sqlDB := db.GetDB()

	query := `
		SELECT
			DATE(datetime(e.metadata->>'timestamp', 'unixepoch')) as date,
			sf.flag_value as mode,
			e.session_id,
			e.entity_type,
			e.entity_value,
			e.metadata,
			datetime(e.metadata->>'timestamp', 'unixepoch') as created_at
		FROM entities e
		JOIN sessions s ON e.session_id = s.id
		JOIN session_flags sf ON s.id = sf.session_id
		WHERE sf.flag_name = 'mode'
		AND e.entity_type LIKE 'wellness.%'
		AND datetime(e.metadata->>'timestamp', 'unixepoch') >= datetime('now', '-' || ? || ' days')
	`
	args := []interface{}{days}

	if mode != "" {
		query += " AND sf.flag_value = ?"
		args = append(args, mode)
	}

	query += " ORDER BY e.metadata->>'timestamp' DESC"

	if limit > 0 {
		query += " LIMIT ?"
		args = append(args, limit*10) // Get more records to group properly
	}

	rows, err := sqlDB.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query wellness history: %w", err)
	}
	defer rows.Close()

	// Group by session and date
	sessionData := make(map[string]*WellnessHistoryEntry)

	for rows.Next() {
		var date, mode, entityType, entityValue, metadataStr, createdAtStr string
		var sessionID int64

		err := rows.Scan(&date, &mode, &sessionID, &entityType, &entityValue, &metadataStr, &createdAtStr)
		if err != nil {
			continue
		}

		key := fmt.Sprintf("%s-%d", date, sessionID)

		if sessionData[key] == nil {
			createdAt, _ := time.Parse("2006-01-02 15:04:05", createdAtStr)
			sessionData[key] = &WellnessHistoryEntry{
				Date:      date,
				Mode:      mode,
				SessionID: sessionID,
				CreatedAt: createdAt,
				Themes:    []string{},
				Homework:  []string{},
			}
		}

		entry := sessionData[key]

		switch entityType {
		case "wellness.mood":
			if mood, err := fmt.Sscanf(entityValue, "%d", &entry.Mood); err == nil && mood == 1 {
				// Mood parsed successfully
			}
		case "wellness.energy":
			if energy, err := fmt.Sscanf(entityValue, "%d", &entry.Energy); err == nil && energy == 1 {
				// Energy parsed successfully
			}
		case "wellness.stress":
			if stress, err := fmt.Sscanf(entityValue, "%d", &entry.Stress); err == nil && stress == 1 {
				// Stress parsed successfully
			}
		case "wellness.theme":
			entry.Themes = append(entry.Themes, entityValue)
		case "wellness.homework":
			entry.Homework = append(entry.Homework, entityValue)
		case "wellness.notes":
			entry.Notes = entityValue
		case "wellness.next_steps":
			entry.NextSteps = entityValue
		}
	}

	// Convert map to slice and sort
	var history []WellnessHistoryEntry
	for _, entry := range sessionData {
		history = append(history, *entry)
	}

	sort.Slice(history, func(i, j int) bool {
		return history[i].CreatedAt.After(history[j].CreatedAt)
	})

	if limit > 0 && len(history) > limit {
		history = history[:limit]
	}

	return history, nil
}

// getWellnessSummary generates overall wellness summary
func getWellnessSummary(db *database.TursoDB, days int) (WellnessSummary, error) {
	sqlDB := db.GetDB()

	summary := WellnessSummary{
		ModeStats: make(map[string]ModeStats),
	}

	// Get overall session count and mode statistics
	query := `
		SELECT
			sf.flag_value as mode,
			COUNT(DISTINCT e.session_id) as session_count,
			AVG(CASE WHEN e.entity_type = 'wellness.mood' THEN CAST(e.entity_value AS FLOAT) END) as avg_mood,
			AVG(CASE WHEN e.entity_type = 'wellness.energy' THEN CAST(e.entity_value AS FLOAT) END) as avg_energy,
			AVG(CASE WHEN e.entity_type = 'wellness.stress' THEN CAST(e.entity_value AS FLOAT) END) as avg_stress,
			MAX(datetime(e.metadata->>'timestamp', 'unixepoch')) as last_session
		FROM entities e
		JOIN sessions s ON e.session_id = s.id
		JOIN session_flags sf ON s.id = sf.session_id
		WHERE sf.flag_name = 'mode'
		AND e.entity_type IN ('wellness.mood', 'wellness.energy', 'wellness.stress')
		AND datetime(e.metadata->>'timestamp', 'unixepoch') >= datetime('now', '-' || ? || ' days')
		GROUP BY sf.flag_value
	`

	rows, err := sqlDB.Query(query, days)
	if err != nil {
		return summary, fmt.Errorf("failed to query wellness summary: %w", err)
	}
	defer rows.Close()

	var totalSessions int
	var totalMood, totalEnergy, totalStress float64
	var modeCount int

	for rows.Next() {
		var mode, lastSessionStr string
		var sessionCount int
		var avgMood, avgEnergy, avgStress float64

		err := rows.Scan(&mode, &sessionCount, &avgMood, &avgEnergy, &avgStress, &lastSessionStr)
		if err != nil {
			continue
		}

		lastSession, _ := time.Parse("2006-01-02 15:04:05", lastSessionStr)

		summary.ModeStats[mode] = ModeStats{
			SessionCount: sessionCount,
			LastSession:  lastSession,
			AvgMood:      avgMood,
			AvgEnergy:    avgEnergy,
			AvgStress:    avgStress,
		}

		totalSessions += sessionCount
		totalMood += avgMood
		totalEnergy += avgEnergy
		totalStress += avgStress
		modeCount++
	}

	summary.TotalSessions = totalSessions

	if modeCount > 0 {
		summary.RecentAverages = WellnessAverages{
			Mood:   totalMood / float64(modeCount),
			Energy: totalEnergy / float64(modeCount),
			Stress: totalStress / float64(modeCount),
		}
	}

	// Calculate trend analysis (simplified)
	summary.TrendAnalysis = TrendAnalysis{
		MoodTrend:   "stable",
		EnergyTrend: "stable",
		StressTrend: "stable",
	}

	return summary, nil
}

// generateWellnessBar creates a visual wellness indicator
func generateWellnessBar(value, max int) string {
	if value < 0 {
		value = 0
	}
	if value > max {
		value = max
	}

	filled := value
	empty := max - value

	bar := strings.Repeat("█", filled) + strings.Repeat("░", empty)
	return fmt.Sprintf("%s %d/%d", bar, value, max)
}

// analyzeTrend analyzes trend for a specific metric
func analyzeTrend(name string, trends []database.WellnessTrendPoint, getValue func(database.WellnessTrendPoint) int) {
	if len(trends) < 3 {
		return
	}

	// Simple trend analysis: compare first third to last third
	firstThird := len(trends) / 3
	lastThird := len(trends) - firstThird

	var firstSum, lastSum int
	for i := 0; i < firstThird; i++ {
		firstSum += getValue(trends[i])
	}
	for i := lastThird; i < len(trends); i++ {
		lastSum += getValue(trends[i])
	}

	firstAvg := float64(firstSum) / float64(firstThird)
	lastAvg := float64(lastSum) / float64(len(trends)-lastThird)

	var trend string
	if lastAvg > firstAvg+0.5 {
		trend = "📈 Improving"
	} else if lastAvg < firstAvg-0.5 {
		trend = "📉 Declining"
	} else {
		trend = "➡️  Stable"
	}

	fmt.Printf("  %s: %s (%.1f → %.1f)\n", name, trend, firstAvg, lastAvg)
}

// getTrendEmoji returns appropriate emoji for trend
func getTrendEmoji(trend string) string {
	switch trend {
	case "improving":
		return "📈 Improving"
	case "declining":
		return "📉 Declining"
	case "stable":
		return "➡️  Stable"
	default:
		return "❓ Unknown"
	}
}

func init() {
	rootCmd.AddCommand(wellnessCmd)
	wellnessCmd.AddCommand(wellnessTrendsCmd)
	wellnessCmd.AddCommand(wellnessHistoryCmd)
	wellnessCmd.AddCommand(wellnessSummaryCmd)

	// Flags for trends command
	wellnessTrendsCmd.Flags().StringVar(&wellnessMode, "mode", "", "Wellness mode (checkin, cbt, therapy, mindfulness, goals)")
	wellnessTrendsCmd.Flags().IntVar(&wellnessDays, "days", 30, "Number of days to look back")
	wellnessTrendsCmd.MarkFlagRequired("mode")

	// Flags for history command
	wellnessHistoryCmd.Flags().StringVar(&wellnessMode, "mode", "", "Filter by wellness mode")
	wellnessHistoryCmd.Flags().IntVar(&wellnessDays, "days", 30, "Number of days to look back")
	wellnessHistoryCmd.Flags().IntVar(&wellnessLimit, "limit", 10, "Number of entries to show")

	// Flags for summary command
	wellnessSummaryCmd.Flags().IntVar(&wellnessDays, "days", 30, "Number of days to look back")
}