package daemon

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"dere/src/database"
	"dere/src/embeddings"
	"dere/src/taskqueue"
)

type Server struct {
	db        *database.TursoDB
	queue     *taskqueue.Queue
	processor *taskqueue.Processor
	ollama    *embeddings.OllamaClient

	listener  net.Listener
	server    *http.Server
	socketPath string

	mu        sync.RWMutex
	stats     map[string]interface{}
}

type JSONRPCRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
	ID      interface{}     `json:"id"`
}

type JSONRPCResponse struct {
	JSONRPC string      `json:"jsonrpc"`
	Result  interface{} `json:"result,omitempty"`
	Error   *RPCError   `json:"error,omitempty"`
	ID      interface{} `json:"id"`
}

type RPCError struct {
	Code    int         `json:"code"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
}

func (e *RPCError) Error() string {
	return e.Message
}

// NewServer creates a new JSON-RPC daemon server
func NewServer(dbPath string, ollama *embeddings.OllamaClient) (*Server, error) {
	db, err := database.NewTursoDB(dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	queue, err := taskqueue.NewQueue(dbPath)
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to create queue: %w", err)
	}

	processor := taskqueue.NewProcessor(queue, db, ollama)

	home, _ := os.UserHomeDir()
	socketPath := filepath.Join(home, ".local", "share", "dere", "daemon.sock")

	return &Server{
		db:         db,
		queue:      queue,
		processor:  processor,
		ollama:     ollama,
		socketPath: socketPath,
		stats:      make(map[string]interface{}),
	}, nil
}

// Start begins listening for JSON-RPC requests
func (s *Server) Start() error {
	// Remove old socket if exists
	os.Remove(s.socketPath)

	// Create Unix domain socket
	listener, err := net.Listen("unix", s.socketPath)
	if err != nil {
		return fmt.Errorf("failed to create socket: %w", err)
	}
	s.listener = listener

	// Set permissions for socket
	if err := os.Chmod(s.socketPath, 0660); err != nil {
		listener.Close()
		return fmt.Errorf("failed to set socket permissions: %w", err)
	}

	// Create HTTP server for JSON-RPC
	mux := http.NewServeMux()
	mux.HandleFunc("/rpc", s.handleRPC)

	s.server = &http.Server{
		Handler:     mux,
		ReadTimeout: 30 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	log.Printf("JSON-RPC server listening on %s", s.socketPath)

	// Start serving in goroutine
	go s.server.Serve(listener)

	// Start background task processing
	go s.processTasksLoop()

	return nil
}

// Stop gracefully shuts down the server
func (s *Server) Stop(ctx context.Context) error {
	if s.server != nil {
		if err := s.server.Shutdown(ctx); err != nil {
			return fmt.Errorf("failed to shutdown server: %w", err)
		}
	}

	if s.listener != nil {
		s.listener.Close()
	}

	// Clean up socket file
	os.Remove(s.socketPath)

	// Close database and queue
	if s.queue != nil {
		s.queue.Close()
	}
	if s.db != nil {
		s.db.Close()
	}

	return nil
}

// handleRPC processes JSON-RPC requests
func (s *Server) handleRPC(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req JSONRPCRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.writeError(w, nil, -32700, "Parse error")
		return
	}

	if req.JSONRPC != "2.0" {
		s.writeError(w, req.ID, -32600, "Invalid Request")
		return
	}

	// Route to appropriate handler
	result, err := s.routeMethod(req.Method, req.Params)
	if err != nil {
		if rpcErr, ok := err.(*RPCError); ok {
			s.writeError(w, req.ID, rpcErr.Code, rpcErr.Message)
		} else {
			s.writeError(w, req.ID, -32603, err.Error())
		}
		return
	}

	// Write successful response
	resp := JSONRPCResponse{
		JSONRPC: "2.0",
		Result:  result,
		ID:      req.ID,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// writeError writes a JSON-RPC error response
func (s *Server) writeError(w http.ResponseWriter, id interface{}, code int, message string) {
	resp := JSONRPCResponse{
		JSONRPC: "2.0",
		Error: &RPCError{
			Code:    code,
			Message: message,
		},
		ID: id,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// processTasksLoop runs the background task processor
func (s *Server) processTasksLoop() {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		if err := s.processor.ProcessTasks(); err != nil {
			log.Printf("Error processing tasks: %v", err)
		}

		// Update stats
		s.updateStats()
	}
}

// updateStats updates server statistics
func (s *Server) updateStats() {
	s.mu.Lock()
	defer s.mu.Unlock()

	stats, err := s.queue.GetStats()
	if err == nil {
		s.stats["queue"] = stats
	}
	s.stats["last_update"] = time.Now().Unix()
}