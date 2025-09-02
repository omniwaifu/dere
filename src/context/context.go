package context

import (
	"fmt"
	"time"
)

// GetContextualPrompt returns time/date contextual information
func GetContextualPrompt() string {
	now := time.Now()
	
	prompt := "# Contextual Information\n\n"
	
	// Time of day context
	hour := now.Hour()
	switch {
	case hour >= 5 && hour < 12:
		prompt += "## Time Context: Morning\n"
		prompt += "- User is likely starting their workday\n"
		prompt += "- Energy levels typically higher\n"
		prompt += "- Good time for planning and focused tasks\n\n"
	case hour >= 12 && hour < 17:
		prompt += "## Time Context: Afternoon\n"
		prompt += "- User is in the middle of their workday\n"
		prompt += "- May be dealing with decision fatigue\n"
		prompt += "- Good time for routine tasks and collaboration\n\n"
	case hour >= 17 && hour < 22:
		prompt += "## Time Context: Evening\n"
		prompt += "- User may be winding down from work\n"
		prompt += "- Could be doing personal projects or learning\n"
		prompt += "- Consider work-life balance in suggestions\n\n"
	default:
		prompt += "## Time Context: Late Night/Early Morning\n"
		prompt += "- User may be tired or under pressure\n"
		prompt += "- Consider suggesting breaks or simpler approaches\n"
		prompt += "- Be extra patient and clear with explanations\n\n"
	}
	
	// Day of week context
	weekday := now.Weekday()
	switch weekday {
	case time.Monday:
		prompt += "## Day Context: Monday\n"
		prompt += "- Start of work week - focus on planning and goal setting\n"
		prompt += "- User may have Monday morning energy or Monday blues\n\n"
	case time.Friday:
		prompt += "## Day Context: Friday\n"
		prompt += "- End of work week - focus on wrapping up tasks\n"
		prompt += "- User may be eager to finish and start weekend\n\n"
	case time.Saturday, time.Sunday:
		prompt += "## Day Context: Weekend\n"
		prompt += "- Personal time - user may be working on side projects\n"
		prompt += "- Be mindful of work-life balance\n\n"
	default:
		prompt += fmt.Sprintf("## Day Context: %s\n", weekday.String())
		prompt += "- Mid-week - user is likely in regular work rhythm\n\n"
	}
	
	// Date context
	prompt += fmt.Sprintf("## Current Date: %s\n", now.Format("January 2, 2006"))
	
	return prompt
}