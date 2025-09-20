package daemon

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"dere/src/config"
	"dere/src/embeddings"
)

// Run starts the daemon with JSON-RPC server
func Run(interval time.Duration) error {
	// Create PID file
	pidPath := getPidFilePath()
	if err := writePidFile(pidPath); err != nil {
		return err
	}
	defer os.Remove(pidPath)

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
	home, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("failed to get home directory: %w", err)
	}
	dbPath := filepath.Join(home, ".local", "share", "dere", "dere.db")

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
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM, syscall.SIGHUP)

	for {
		select {
		case sig := <-sigChan:
			switch sig {
			case syscall.SIGHUP:
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

	if err := process.Signal(syscall.Signal(0)); err != nil {
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

	if err := process.Signal(syscall.SIGTERM); err != nil {
		return fmt.Errorf("failed to send SIGTERM: %w", err)
	}

	// Wait for graceful shutdown
	time.Sleep(2 * time.Second)

	// Check if still running
	if err := process.Signal(syscall.Signal(0)); err == nil {
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
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".local", "share", "dere", "daemon.pid")
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