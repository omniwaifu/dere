package cmd

import (
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"dere/src/config"
	"dere/src/database"
	"dere/src/embeddings"
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
	// Create PID file
	pidPath := getPidFilePath()
	pidFile, err := os.Create(pidPath)
	if err != nil {
		return fmt.Errorf("failed to create PID file: %w", err)
	}

	if _, err := pidFile.WriteString(fmt.Sprintf("%d", os.Getpid())); err != nil {
		pidFile.Close()
		os.Remove(pidPath)
		return fmt.Errorf("failed to write PID: %w", err)
	}
	pidFile.Close()

	// Cleanup PID file on exit
	defer func() {
		os.Remove(pidPath)
	}()

	// Setup signal handling for graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

	// Initialize components
	home, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("failed to get home directory: %w", err)
	}

	dbPath := filepath.Join(home, ".local", "share", "dere", "dere.db")
	db, err := database.NewTursoDB(dbPath)
	if err != nil {
		return fmt.Errorf("failed to open database: %w", err)
	}
	defer db.Close()

	queue, err := taskqueue.NewQueue(dbPath)
	if err != nil {
		return fmt.Errorf("failed to create task queue: %w", err)
	}
	defer queue.Close()

	// Initialize Ollama client
	configSettings, err := config.LoadSettings()
	if err != nil || !configSettings.Ollama.Enabled {
		return fmt.Errorf("Ollama configuration not found or disabled")
	}

	ollamaConfig := &config.OllamaConfig{
		Enabled:        true,
		URL:            configSettings.Ollama.URL,
		EmbeddingModel: configSettings.Ollama.EmbeddingModel,
	}

	ollama := embeddings.NewOllamaClient(ollamaConfig)
	processor := taskqueue.NewProcessor(queue, db, ollama)

	fmt.Printf("Daemon started successfully (PID: %d)\n", os.Getpid())
	fmt.Printf("Processing interval: %v\n", daemonInterval)

	// Main processing loop
	ticker := time.NewTicker(daemonInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			if err := processor.ProcessTasks(); err != nil {
				fmt.Printf("Error processing tasks: %v\n", err)
			}

		case sig := <-sigChan:
			fmt.Printf("\nReceived signal %v, shutting down gracefully...\n", sig)
			return nil
		}
	}
}

func stopDaemon(pid int) error {
	process, err := os.FindProcess(pid)
	if err != nil {
		return fmt.Errorf("failed to find process: %w", err)
	}

	if err := process.Signal(syscall.SIGTERM); err != nil {
		return fmt.Errorf("failed to send SIGTERM: %w", err)
	}

	// Wait a bit for graceful shutdown
	time.Sleep(2 * time.Second)

	// Check if process is still running
	if err := process.Signal(syscall.Signal(0)); err == nil {
		// Still running, force kill
		fmt.Println("Graceful shutdown timed out, forcing kill...")
		if err := process.Kill(); err != nil {
			return fmt.Errorf("failed to kill process: %w", err)
		}
	}

	// Clean up PID file
	os.Remove(getPidFilePath())
	fmt.Println("Daemon stopped successfully")
	return nil
}

func isDaemonRunning() (bool, int) {
	pidPath := getPidFilePath()
	data, err := os.ReadFile(pidPath)
	if err != nil {
		return false, 0
	}

	pid, err := strconv.Atoi(string(data))
	if err != nil {
		return false, 0
	}

	// Check if process is actually running
	process, err := os.FindProcess(pid)
	if err != nil {
		return false, 0
	}

	if err := process.Signal(syscall.Signal(0)); err != nil {
		// Process doesn't exist, clean up stale PID file
		os.Remove(pidPath)
		return false, 0
	}

	return true, pid
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
	daemonCmd.AddCommand(daemonStatusCmd)

	// Flags
	daemonStartCmd.Flags().DurationVar(&daemonInterval, "interval", 10*time.Second, "Processing interval")
	daemonStartCmd.Flags().StringVar(&daemonLogFile, "log", "", "Log file path (default: stdout)")
}