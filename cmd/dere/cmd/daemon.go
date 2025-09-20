package cmd

import (
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"time"

	"dere/src/daemon"
	"dere/src/taskqueue"

	"github.com/spf13/cobra"
)

var (
	daemonInterval time.Duration
	daemonLogFile  string
)

// daemonCmd represents the daemon command
var daemonCmd = &cobra.Command{
	Use:   "daemon",
	Short: "Manage the task processing daemon",
	Long: `Manage the background task processing daemon for embeddings, summarization, and other LLM tasks.

The daemon processes queued tasks in batches, optimizing for model switching overhead.`,
}

// daemonStartCmd starts the daemon
var daemonStartCmd = &cobra.Command{
	Use:   "start",
	Short: "Start the task processing daemon",
	RunE: func(cmd *cobra.Command, args []string) error {
		// Check if daemon is already running
		if isRunning, pid := isDaemonRunning(); isRunning {
			return fmt.Errorf("daemon is already running (PID: %d)", pid)
		}

		fmt.Println("Starting dere task processing daemon...")
		return startDaemon()
	},
}

// daemonStopCmd stops the daemon
var daemonStopCmd = &cobra.Command{
	Use:   "stop",
	Short: "Stop the task processing daemon",
	RunE: func(cmd *cobra.Command, args []string) error {
		isRunning, pid := isDaemonRunning()
		if !isRunning {
			fmt.Println("Daemon is not running")
			return nil
		}

		fmt.Printf("Stopping daemon (PID: %d)...\n", pid)
		return stopDaemon(pid)
	},
}

// daemonRestartCmd restarts the daemon
var daemonRestartCmd = &cobra.Command{
	Use:   "restart",
	Short: "Restart the task processing daemon",
	RunE: func(cmd *cobra.Command, args []string) error {
		isRunning, pid := isDaemonRunning()
		if isRunning {
			fmt.Printf("Stopping daemon (PID: %d)...\n", pid)
			if err := stopDaemon(pid); err != nil {
				return fmt.Errorf("failed to stop daemon: %w", err)
			}
		}

		fmt.Println("Starting dere task processing daemon...")
		return startDaemon()
	},
}

// daemonReloadCmd reloads daemon configuration
var daemonReloadCmd = &cobra.Command{
	Use:   "reload",
	Short: "Reload daemon configuration (SIGHUP)",
	RunE: func(cmd *cobra.Command, args []string) error {
		isRunning, pid := isDaemonRunning()
		if !isRunning {
			return fmt.Errorf("daemon is not running")
		}

		process, err := os.FindProcess(pid)
		if err != nil {
			return fmt.Errorf("failed to find process: %w", err)
		}

		if err := process.Signal(syscall.SIGHUP); err != nil {
			return fmt.Errorf("failed to send SIGHUP: %w", err)
		}

		fmt.Printf("Sent SIGHUP to daemon (PID: %d)\n", pid)
		return nil
	},
}

// daemonStatusCmd shows daemon status
var daemonStatusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show daemon status",
	RunE: func(cmd *cobra.Command, args []string) error {
		isRunning, pid := isDaemonRunning()
		if isRunning {
			fmt.Printf("Daemon is running (PID: %d)\n", pid)

			// Show queue stats
			return showQueueStats()
		} else {
			fmt.Println("Daemon is not running")
			return nil
		}
	},
}

func startDaemon() error {
	// Use the new daemon server
	return daemon.Run(daemonInterval)
}

func stopDaemon(pid int) error {
	if err := daemon.Stop(pid); err != nil {
		return err
	}
	fmt.Println("Daemon stopped successfully")
	return nil
}

func isDaemonRunning() (bool, int) {
	return daemon.IsRunning()
}

func getPidFilePath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".local", "share", "dere", "daemon.pid")
}


func showQueueStats() error {
	home, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("failed to get home directory: %w", err)
	}

	dbPath := filepath.Join(home, ".local", "share", "dere", "dere.db")
	queue, err := taskqueue.NewQueue(dbPath)
	if err != nil {
		return fmt.Errorf("failed to create task queue: %w", err)
	}
	defer queue.Close()

	stats, err := queue.GetStats()
	if err != nil {
		return fmt.Errorf("failed to get queue stats: %w", err)
	}

	fmt.Println("\nQueue Statistics:")

	if statusStats, ok := stats["by_status"].(map[string]int); ok {
		fmt.Println("  By Status:")
		for status, count := range statusStats {
			fmt.Printf("    %s: %d\n", status, count)
		}
	}

	if modelStats, ok := stats["pending_by_model"].(map[string]int); ok && len(modelStats) > 0 {
		fmt.Println("  Pending by Model:")
		for model, count := range modelStats {
			fmt.Printf("    %s: %d\n", model, count)
		}
	}

	return nil
}

func init() {
	rootCmd.AddCommand(daemonCmd)
	daemonCmd.AddCommand(daemonStartCmd)
	daemonCmd.AddCommand(daemonStopCmd)
	daemonCmd.AddCommand(daemonRestartCmd)
	daemonCmd.AddCommand(daemonReloadCmd)
	daemonCmd.AddCommand(daemonStatusCmd)

	// Flags
	daemonStartCmd.Flags().DurationVar(&daemonInterval, "interval", 10*time.Second, "Processing interval")
	daemonStartCmd.Flags().StringVar(&daemonLogFile, "log", "", "Log file path (default: stdout)")
}