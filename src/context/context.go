package context

import (
	"fmt"
	"time"
	
	"dere/src/activitywatch"
	"dere/src/config"
)

// GetContextualPrompt returns time/date contextual information
func GetContextualPrompt() string {
	now := time.Now()
	
	prompt := "# Contextual Information\n\n"
	
	// Exact time and date
	prompt += fmt.Sprintf("## Current Time: %s\n", now.Format("15:04:05 MST"))
	prompt += fmt.Sprintf("## Current Date: %s\n", now.Format("Monday, January 2, 2006"))
	prompt += fmt.Sprintf("## Timezone: %s\n\n", now.Location().String())
	
	// Add ActivityWatch context if enabled
	settings, err := config.LoadSettings()
	if err == nil && settings.ActivityWatch.Enabled {
		awContext := GetActivityWatchContext(settings)
		if awContext != "" {
			prompt += awContext + "\n"
		}
	}
	
	return prompt
}

// GetActivityWatchContext queries ActivityWatch for recent user activity
func GetActivityWatchContext(settings *config.Settings) string {
	if !settings.ActivityWatch.Enabled {
		return ""
	}
	
	client := activitywatch.NewClient(settings.ActivityWatch.URL)
	summaries, err := client.GetRecentActivity(settings.ActivityWatch.LookbackMinutes)
	if err != nil {
		// Silently fail if ActivityWatch is unavailable
		return ""
	}
	
	return activitywatch.FormatActivitySummaries(summaries, settings.ActivityWatch.LookbackMinutes)
}