package core

import (
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// Context holds runtime information for prompt assembly
type Context struct {
	Flags          map[string]string
	ActiveCapabilities []string
	CurrentTime    time.Time
	CommandCache   map[string]string // Cache for external command results
}

// NewContext creates a new context with defaults
func NewContext() *Context {
	return &Context{
		Flags:        make(map[string]string),
		CurrentTime:  time.Now(),
		CommandCache: make(map[string]string),
	}
}

// RunCommand executes an external command and caches the result
func (c *Context) RunCommand(command string, args ...string) (string, error) {
	cacheKey := command + " " + strings.Join(args, " ")
	
	if cached, ok := c.CommandCache[cacheKey]; ok {
		return cached, nil
	}

	cmd := exec.Command(command, args...)
	output, err := cmd.Output()
	if err != nil {
		return "", err
	}

	result := strings.TrimSpace(string(output))
	c.CommandCache[cacheKey] = result
	return result, nil
}

// GetTaskCount returns the count of tasks matching the filter
func (c *Context) GetTaskCount(filter string) int {
	output, err := c.RunCommand("task", "count", filter)
	if err != nil {
		return 0
	}
	
	count, _ := strconv.Atoi(output)
	return count
}

// GetOverdueCount returns the number of overdue tasks
func (c *Context) GetOverdueCount() int {
	return c.GetTaskCount("+OVERDUE")
}

// GetPendingCount returns the number of pending tasks
func (c *Context) GetPendingCount() int {
	return c.GetTaskCount("status:pending")
}