package activitywatch

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"time"
)

type Event struct {
	ID        int                    `json:"id"`
	Timestamp time.Time              `json:"timestamp"`
	Duration  float64                `json:"duration"`
	Data      map[string]interface{} `json:"data"`
}

type ActivitySummary struct {
	App      string
	Title    string
	Duration time.Duration
}

type Client struct {
	baseURL string
	client  *http.Client
}

func NewClient(url string) *Client {
	return &Client{
		baseURL: url,
		client: &http.Client{
			Timeout: 5 * time.Second,
		},
	}
}

func (c *Client) GetRecentActivity(lookbackMinutes int) ([]ActivitySummary, error) {
	hostname, err := os.Hostname()
	if err != nil {
		return nil, fmt.Errorf("failed to get hostname: %w", err)
	}

	// Get window events
	windowBucket := fmt.Sprintf("aw-watcher-window_%s", hostname)
	windowEvents, err := c.getEventsFromBucket(windowBucket, lookbackMinutes)
	if err != nil {
		return nil, fmt.Errorf("failed to get window events: %w", err)
	}

	// Get AFK events to filter out inactive periods
	afkBucket := fmt.Sprintf("aw-watcher-afk_%s", hostname)
	afkEvents, err := c.getEventsFromBucket(afkBucket, lookbackMinutes)
	if err != nil {
		// If we can't get AFK events, just use all window events
		return c.processEvents(windowEvents), nil
	}

	// Filter window events to only include non-AFK periods
	activeEvents := c.filterActiveEvents(windowEvents, afkEvents)
	return c.processEvents(activeEvents), nil
}

func (c *Client) getEventsFromBucket(bucketID string, lookbackMinutes int) ([]Event, error) {
	// Calculate the start time
	now := time.Now()
	start := now.Add(-time.Duration(lookbackMinutes) * time.Minute)
	
	// Fetch events from the bucket with time filter
	url := fmt.Sprintf("%s/api/0/buckets/%s/events?start=%s&end=%s&limit=1000", 
		c.baseURL, bucketID, start.Format(time.RFC3339), now.Format(time.RFC3339))
	
	resp, err := c.client.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("API error (status %d): %s", resp.StatusCode, string(body))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var events []Event
	if err := json.Unmarshal(body, &events); err != nil {
		return nil, err
	}

	return events, nil
}

func (c *Client) filterActiveEvents(windowEvents, afkEvents []Event) []Event {
	var activeEvents []Event
	
	for _, windowEvent := range windowEvents {
		isActive := false
		windowStart := windowEvent.Timestamp
		windowEnd := windowEvent.Timestamp.Add(time.Duration(windowEvent.Duration * float64(time.Second)))
		
		// Check if this window event overlaps with any non-AFK period
		for _, afkEvent := range afkEvents {
			if status, ok := afkEvent.Data["status"].(string); ok && status == "not-afk" {
				afkStart := afkEvent.Timestamp
				afkEnd := afkEvent.Timestamp.Add(time.Duration(afkEvent.Duration * float64(time.Second)))
				
				// Check for overlap
				if windowStart.Before(afkEnd) && windowEnd.After(afkStart) {
					isActive = true
					break
				}
			}
		}
		
		if isActive {
			activeEvents = append(activeEvents, windowEvent)
		}
	}
	
	return activeEvents
}

func (c *Client) processEvents(events []Event) []ActivitySummary {
	appDurations := make(map[string]time.Duration)
	appTitles := make(map[string]string)

	for _, event := range events {
		app, _ := event.Data["app"].(string)
		title, _ := event.Data["title"].(string)
		
		if app == "" {
			continue
		}

		duration := time.Duration(event.Duration * float64(time.Second))
		appDurations[app] += duration
		
		if title != "" && appTitles[app] == "" {
			appTitles[app] = title
		}
	}

	var summaries []ActivitySummary
	for app, duration := range appDurations {
		summaries = append(summaries, ActivitySummary{
			App:      app,
			Title:    appTitles[app],
			Duration: duration,
		})
	}

	sort.Slice(summaries, func(i, j int) bool {
		return summaries[i].Duration > summaries[j].Duration
	})

	if len(summaries) > 5 {
		summaries = summaries[:5]
	}

	return summaries
}

func FormatActivitySummaries(summaries []ActivitySummary, lookbackMinutes int) string {
	if len(summaries) == 0 {
		return ""
	}

	result := fmt.Sprintf("## Recent Activity (last %d minutes):\n", lookbackMinutes)
	for _, summary := range summaries {
		minutes := int(summary.Duration.Minutes())
		seconds := int(summary.Duration.Seconds()) % 60
		
		if minutes > 0 {
			result += fmt.Sprintf("- %s: %dm %ds\n", summary.App, minutes, seconds)
		} else {
			result += fmt.Sprintf("- %s: %ds\n", summary.App, seconds)
		}
	}
	
	return result
}