package daemon

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"syscall"
	"time"

	"dere/src/config"
	"dere/src/embeddings"
)

// isProcessRunning checks if a process is running (cross-platform)
// On Windows, FindProcess succeeding means the process exists
// On Unix, we need to send signal 0 to verify
func isProcessRunning(process *os.Process) bool {
	if process == nil {
		return false
	}

	if runtime.GOOS == "windows" {
		// On Windows, FindProcess always succeeds, so we return true
		// The process handle will fail on actual operations if process doesn't exist
		return true
	}

	// On Unix, send signal 0 to check if process exists
	return process.Signal(syscall.Signal(0)) == nil
}

// terminateProcess terminates a process gracefully (cross-platform)
// On Windows, uses Kill() since there's no SIGTERM
// On Unix, uses SIGTERM for graceful shutdown
func terminateProcess(process *os.Process) error {
	if runtime.GOOS == "windows" {
		return process.Kill()
	}
	return process.Signal(syscall.SIGTERM)
}

// Run starts the daemon with JSON-RPC server
func Run(interval time.Duration) error {
	// Clean up any stale files from previous runs
	if err := cleanupStaleFiles(); err != nil {
		log.Printf("Warning: Failed to clean stale files: %v", err)
	}

	// Create PID file
	pidPath := getPidFilePath()
	if err := writePidFile(pidPath); err != nil {
		return err
	}
	defer func() {
		if err := os.Remove(pidPath); err != nil {
			log.Printf("Warning: Failed to remove PID file: %v", err)
		} else {
			log.Printf("Cleaned up PID file: %s", pidPath)
		}
	}()

	// Initialize configuration
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

	// Get database path
	dataDir, err := config.GetDataDir()
	if err != nil {
		return fmt.Errorf("failed to get data directory: %w", err)
	}
	dbPath := filepath.Join(dataDir, "dere.db")

	// Create and start JSON-RPC server
	server, err := NewServer(dbPath, ollama)
	if err != nil {
		return fmt.Errorf("failed to create server: %w", err)
	}

	if err := server.Start(); err != nil {
		return fmt.Errorf("failed to start server: %w", err)
	}

	log.Printf("Daemon started successfully (PID: %d)", os.Getpid())
	log.Printf("Processing interval: %v", interval)
	log.Printf("JSON-RPC socket: %s", server.socketPath)

	// Setup signal handling
	sigChan := make(chan os.Signal, 1)
	if runtime.GOOS == "windows" {
		// Windows doesn't support SIGHUP
		signal.Notify(sigChan, os.Interrupt)
	} else {
		signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM, syscall.SIGHUP)
	}

	for {
		select {
		case sig := <-sigChan:
			switch sig {
			case syscall.SIGHUP:
				// SIGHUP only available on Unix
				log.Println("Received SIGHUP, reloading configuration...")
				// Reload configuration
				if newConfig, err := config.LoadSettings(); err == nil {
					ollamaConfig.URL = newConfig.Ollama.URL
					ollamaConfig.EmbeddingModel = newConfig.Ollama.EmbeddingModel
					log.Println("Configuration reloaded successfully")
				} else {
					log.Printf("Failed to reload config: %v", err)
				}
			default:
				log.Printf("Received signal %v, shutting down gracefully...", sig)
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				return server.Stop(ctx)
			}
		}
	}
}

// IsRunning checks if daemon is already running
func IsRunning() (bool, int) {
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

	if !isProcessRunning(process) {
		// Process doesn't exist, clean up stale PID file
		os.Remove(pidPath)
		return false, 0
	}

	return true, pid
}

// Stop stops a running daemon
func Stop(pid int) error {
	process, err := os.FindProcess(pid)
	if err != nil {
		return fmt.Errorf("failed to find process: %w", err)
	}

	if err := terminateProcess(process); err != nil {
		return fmt.Errorf("failed to terminate process: %w", err)
	}

	// Wait for graceful shutdown
	time.Sleep(2 * time.Second)

	// Check if still running
	if isProcessRunning(process) {
		// Force kill
		log.Println("Graceful shutdown timed out, forcing kill...")
		if err := process.Kill(); err != nil {
			return fmt.Errorf("failed to kill process: %w", err)
		}
	}

	// Clean up PID file
	os.Remove(getPidFilePath())
	return nil
}

func getPidFilePath() string {
	dataDir, _ := config.GetDataDir()
	return filepath.Join(dataDir, "daemon.pid")
}

func writePidFile(path string) error {
	pidFile, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("failed to create PID file: %w", err)
	}
	defer pidFile.Close()

	if _, err := pidFile.WriteString(fmt.Sprintf("%d", os.Getpid())); err != nil {
		return fmt.Errorf("failed to write PID: %w", err)
	}
	return nil
}

func cleanupStaleFiles() error {
	pidPath := getPidFilePath()
	socketPath := getSocketPath()

	// Check if PID file exists
	data, err := os.ReadFile(pidPath)
	if err != nil {
		if os.IsNotExist(err) {
			// No PID file, check for stale socket
			if err := cleanupSocket(socketPath); err != nil {
				log.Printf("Warning: Failed to cleanup stale socket: %v", err)
			}
			return nil
		}
		return fmt.Errorf("failed to read PID file: %w", err)
	}

	pid, err := strconv.Atoi(string(data))
	if err != nil {
		log.Printf("Invalid PID in file, removing stale PID file: %s", pidPath)
		if err := os.Remove(pidPath); err != nil {
			log.Printf("Warning: Failed to remove invalid PID file: %v", err)
		}
		if err := cleanupSocket(socketPath); err != nil {
			log.Printf("Warning: Failed to cleanup socket after invalid PID: %v", err)
		}
		return nil
	}

	// Check if process is actually running
	process, err := os.FindProcess(pid)
	if err != nil {
		log.Printf("Process %d not found, cleaning up stale files", pid)
		return cleanupStaleFilesForce(pidPath, socketPath)
	}

	// Check if process exists (cross-platform)
	if !isProcessRunning(process) {
		log.Printf("Process %d not running, cleaning up stale files", pid)
		return cleanupStaleFilesForce(pidPath, socketPath)
	}

	log.Printf("Daemon already running with PID %d", pid)
	return fmt.Errorf("daemon already running with PID %d", pid)
}

func cleanupStaleFilesForce(pidPath, socketPath string) error {
	var errors []error

	// Remove PID file
	if err := os.Remove(pidPath); err != nil && !os.IsNotExist(err) {
		errors = append(errors, fmt.Errorf("failed to remove PID file: %w", err))
		log.Printf("Warning: Failed to remove PID file %s: %v", pidPath, err)
	} else if err == nil {
		log.Printf("Removed stale PID file: %s", pidPath)
	}

	// Remove socket file
	if err := cleanupSocket(socketPath); err != nil {
		errors = append(errors, err)
	}

	if len(errors) > 0 {
		return fmt.Errorf("cleanup errors: %v", errors)
	}
	return nil
}

func cleanupSocket(socketPath string) error {
	if err := os.Remove(socketPath); err != nil && !os.IsNotExist(err) {
		log.Printf("Warning: Failed to remove socket file %s: %v", socketPath, err)
		return fmt.Errorf("failed to remove socket file: %w", err)
	} else if err == nil {
		log.Printf("Removed stale socket file: %s", socketPath)
	}
	return nil
}

func getSocketPath() string {
	dataDir, _ := config.GetDataDir()
	return filepath.Join(dataDir, "daemon.sock")
}