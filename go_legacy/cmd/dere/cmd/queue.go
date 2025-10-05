package cmd

import (
	"fmt"
	"path/filepath"
	"strconv"
	"time"

	dconfig "dere/src/config"
	"dere/src/taskqueue"

	"github.com/spf13/cobra"
)

var (
	queueLimit int
	queueModel string
)

// queueCmd represents the queue command
var queueCmd = &cobra.Command{
	Use:   "queue",
	Short: "Manage the task queue",
	Long: `Manage and monitor the background task processing queue.

View pending tasks, process tasks manually, and monitor queue status.`,
}

// queueListCmd lists tasks in the queue
var queueListCmd = &cobra.Command{
	Use:   "list",
	Short: "List tasks in the queue",
	RunE: func(cmd *cobra.Command, args []string) error {
		queue, err := getTaskQueue()
		if err != nil {
			return err
		}
		defer queue.Close()

		tasks, err := queue.GetPendingTasks(queueModel, queueLimit)
		if err != nil {
			return fmt.Errorf("failed to get pending tasks: %w", err)
		}

		if len(tasks) == 0 {
			fmt.Println("No pending tasks")
			return nil
		}

		fmt.Printf("Pending tasks (%d):\n\n", len(tasks))

		for i, task := range tasks {
			fmt.Printf("%d. [%s] %s\n", i+1, task.CreatedAt.Format("15:04:05"), task.TaskType)
			fmt.Printf("   ID: %d\n", task.ID)
			fmt.Printf("   Model: %s\n", task.ModelName)
			fmt.Printf("   Priority: %d\n", task.Priority)
			fmt.Printf("   Content: %s\n", truncateString(task.Content, 80))
			if task.RetryCount > 0 {
				fmt.Printf("   Retries: %d\n", task.RetryCount)
			}
			fmt.Println()
		}

		return nil
	},
}

// queueStatusCmd shows queue status
var queueStatusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show queue status",
	RunE: func(cmd *cobra.Command, args []string) error {
		queue, err := getTaskQueue()
		if err != nil {
			return err
		}
		defer queue.Close()

		stats, err := queue.GetStats()
		if err != nil {
			return fmt.Errorf("failed to get queue stats: %w", err)
		}

		fmt.Println("Task Queue Status:")
		fmt.Println()

		if statusStats, ok := stats["by_status"].(map[string]int); ok {
			fmt.Println("Tasks by Status:")
			total := 0
			for status, count := range statusStats {
				fmt.Printf("  %-12s: %d\n", status, count)
				total += count
			}
			fmt.Printf("  %-12s: %d\n", "Total", total)
			fmt.Println()
		}

		if modelStats, ok := stats["pending_by_model"].(map[string]int); ok && len(modelStats) > 0 {
			fmt.Println("Pending Tasks by Model:")
			for model, count := range modelStats {
				fmt.Printf("  %-20s: %d\n", model, count)
			}
			fmt.Println()
		}

		// Show daemon status
		if isRunning, pid := isDaemonRunning(); isRunning {
			fmt.Printf("Daemon: Running (PID: %d)\n", pid)
		} else {
			fmt.Println("Daemon: Not running")
		}

		return nil
	},
}

// queueProcessCmd manually processes the queue
var queueProcessCmd = &cobra.Command{
	Use:   "process",
	Short: "Manually process pending tasks",
	RunE: func(cmd *cobra.Command, args []string) error {
		// Check if daemon is running
		if isRunning, pid := isDaemonRunning(); isRunning {
			fmt.Printf("Warning: Daemon is already running (PID: %d)\n", pid)
			fmt.Println("Manual processing may conflict with daemon. Continue? (y/N)")

			var response string
			fmt.Scanln(&response)
			if response != "y" && response != "Y" {
				fmt.Println("Aborted")
				return nil
			}
		}

		fmt.Println("Processing pending tasks...")
		return processQueueManually()
	},
}

// queueClearCmd clears failed tasks
var queueClearCmd = &cobra.Command{
	Use:   "clear",
	Short: "Clear completed/failed tasks",
	RunE: func(cmd *cobra.Command, args []string) error {
		queue, err := getTaskQueue()
		if err != nil {
			return err
		}
		defer queue.Close()

		// Clear tasks older than 24 hours
		count, err := queue.DeleteCompletedTasks(24 * time.Hour)
		if err != nil {
			return fmt.Errorf("failed to clear tasks: %w", err)
		}

		fmt.Printf("Cleared %d completed/failed tasks\n", count)
		return nil
	},
}

// queueRetryCmd retries a failed task
var queueRetryCmd = &cobra.Command{
	Use:   "retry <task-id>",
	Short: "Retry a failed task",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		taskID, err := strconv.ParseInt(args[0], 10, 64)
		if err != nil {
			return fmt.Errorf("invalid task ID: %w", err)
		}

		queue, err := getTaskQueue()
		if err != nil {
			return err
		}
		defer queue.Close()

		task, err := queue.GetTask(taskID)
		if err != nil {
			return fmt.Errorf("failed to get task: %w", err)
		}

		if task.Status != taskqueue.TaskStatusFailed {
			return fmt.Errorf("task %d is not in failed status (current: %s)", taskID, task.Status)
		}

		// Reset task to pending
		if err := queue.UpdateStatus(taskID, taskqueue.TaskStatusPending, nil); err != nil {
			return fmt.Errorf("failed to reset task status: %w", err)
		}

		fmt.Printf("Task %d reset to pending status\n", taskID)
		return nil
	},
}

func getTaskQueue() (*taskqueue.Queue, error) {
	dataDir, err := dconfig.GetDataDir()
	if err != nil {
		return nil, fmt.Errorf("failed to get data directory: %w", err)
	}

	dbPath := filepath.Join(dataDir, "dere.db")
	return taskqueue.NewQueue(dbPath)
}

func processQueueManually() error {
	// Initialize the same components as daemon
	dataDir, err := dconfig.GetDataDir()
	if err != nil {
		return fmt.Errorf("failed to get data directory: %w", err)
	}

	dbPath := filepath.Join(dataDir, "dere.db")

	// Initialize components (similar to daemon)
	// This is a simplified version for manual processing
	queue, err := taskqueue.NewQueue(dbPath)
	if err != nil {
		return fmt.Errorf("failed to create task queue: %w", err)
	}
	defer queue.Close()

	// Get pending tasks grouped by model
	tasksByModel, err := queue.GetTasksByModel()
	if err != nil {
		return fmt.Errorf("failed to get tasks by model: %w", err)
	}

	if len(tasksByModel) == 0 {
		fmt.Println("No pending tasks to process")
		return nil
	}

	totalTasks := 0
	for model, tasks := range tasksByModel {
		count := len(tasks)
		totalTasks += count
		fmt.Printf("Found %d tasks for model %s\n", count, model)
	}

	fmt.Printf("\nTotal: %d pending tasks\n", totalTasks)
	fmt.Println("Note: This is a simplified manual processor.")
	fmt.Println("For full processing with Ollama integration, use 'dere daemon start'")

	return nil
}

func truncateString(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	if maxLen <= 3 {
		return "..."
	}
	return s[:maxLen-3] + "..."
}

func init() {
	rootCmd.AddCommand(queueCmd)
	queueCmd.AddCommand(queueListCmd)
	queueCmd.AddCommand(queueStatusCmd)
	queueCmd.AddCommand(queueProcessCmd)
	queueCmd.AddCommand(queueClearCmd)
	queueCmd.AddCommand(queueRetryCmd)

	// Flags
	queueListCmd.Flags().IntVar(&queueLimit, "limit", 20, "Number of tasks to show")
	queueListCmd.Flags().StringVar(&queueModel, "model", "", "Filter by model name")
}