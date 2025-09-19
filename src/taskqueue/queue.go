package taskqueue

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"dere/src/database"
)

// Queue manages tasks in the SQLite database
type Queue struct {
	db     *sql.DB
	tursoDB *database.TursoDB
}

// NewQueue creates a new task queue
func NewQueue(dbPath string) (*Queue, error) {
	// Use the main database package to ensure proper schema initialization
	tursoDB, err := database.NewTursoDB(dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize database: %w", err)
	}

	return &Queue{
		db:      tursoDB.GetDB(), // We'll need to add this method
		tursoDB: tursoDB,
	}, nil
}

// Close closes the database connection
func (q *Queue) Close() error {
	return q.tursoDB.Close()
}

// Add adds a new task to the queue
func (q *Queue) Add(taskType TaskType, modelName, content string, metadata interface{}, priority int, sessionID *int64) (*Task, error) {
	task := &Task{
		TaskType:  taskType,
		ModelName: modelName,
		Content:   content,
		Priority:  priority,
		Status:    TaskStatusPending,
		SessionID: sessionID,
		CreatedAt: time.Now(),
	}

	if metadata != nil {
		if err := task.SetMetadata(metadata); err != nil {
			return nil, fmt.Errorf("failed to set metadata: %w", err)
		}
	}

	metadataJSON, _ := json.Marshal(task.Metadata)

	query := `
		INSERT INTO task_queue (task_type, model_name, content, metadata, priority, session_id)
		VALUES (?, ?, ?, ?, ?, ?)
	`

	result, err := q.db.Exec(query, string(taskType), modelName, content, string(metadataJSON), priority, sessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to insert task: %w", err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("failed to get task ID: %w", err)
	}

	task.ID = id
	return task, nil
}

// GetPendingTasks returns pending tasks, optionally filtered by model
func (q *Queue) GetPendingTasks(modelName string, limit int) ([]*Task, error) {
	var query string
	var args []interface{}

	if modelName != "" {
		query = `
			SELECT id, task_type, model_name, content, metadata, priority, status, session_id,
			       created_at, processed_at, retry_count, error_message
			FROM task_queue
			WHERE status = 'pending' AND model_name = ?
			ORDER BY priority ASC, created_at ASC
			LIMIT ?
		`
		args = []interface{}{modelName, limit}
	} else {
		query = `
			SELECT id, task_type, model_name, content, metadata, priority, status, session_id,
			       created_at, processed_at, retry_count, error_message
			FROM task_queue
			WHERE status = 'pending'
			ORDER BY priority ASC, created_at ASC
			LIMIT ?
		`
		args = []interface{}{limit}
	}

	rows, err := q.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query pending tasks: %w", err)
	}
	defer rows.Close()

	return q.scanTasks(rows)
}

// GetTasksByModel returns pending tasks grouped by model
func (q *Queue) GetTasksByModel() (map[string][]*Task, error) {
	query := `
		SELECT model_name, COUNT(*) as count
		FROM task_queue
		WHERE status = 'pending'
		GROUP BY model_name
		ORDER BY count DESC
	`

	rows, err := q.db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("failed to query tasks by model: %w", err)
	}
	defer rows.Close()

	result := make(map[string][]*Task)

	for rows.Next() {
		var modelName string
		var count int
		if err := rows.Scan(&modelName, &count); err != nil {
			continue
		}

		tasks, err := q.GetPendingTasks(modelName, count)
		if err != nil {
			continue
		}

		result[modelName] = tasks
	}

	return result, nil
}

// UpdateStatus updates the status of a task
func (q *Queue) UpdateStatus(taskID int64, status TaskStatus, errorMessage *string) error {
	var processedAt *time.Time
	if status == TaskStatusCompleted || status == TaskStatusFailed {
		now := time.Now()
		processedAt = &now
	}

	query := `
		UPDATE task_queue
		SET status = ?, processed_at = ?, error_message = ?
		WHERE id = ?
	`

	_, err := q.db.Exec(query, string(status), processedAt, errorMessage, taskID)
	if err != nil {
		return fmt.Errorf("failed to update task status: %w", err)
	}

	return nil
}

// IncrementRetry increments the retry count for a task
func (q *Queue) IncrementRetry(taskID int64) error {
	query := `UPDATE task_queue SET retry_count = retry_count + 1 WHERE id = ?`
	_, err := q.db.Exec(query, taskID)
	if err != nil {
		return fmt.Errorf("failed to increment retry count: %w", err)
	}
	return nil
}

// GetTask gets a specific task by ID
func (q *Queue) GetTask(taskID int64) (*Task, error) {
	query := `
		SELECT id, task_type, model_name, content, metadata, priority, status, session_id,
		       created_at, processed_at, retry_count, error_message
		FROM task_queue
		WHERE id = ?
	`

	rows, err := q.db.Query(query, taskID)
	if err != nil {
		return nil, fmt.Errorf("failed to query task: %w", err)
	}
	defer rows.Close()

	tasks, err := q.scanTasks(rows)
	if err != nil {
		return nil, err
	}

	if len(tasks) == 0 {
		return nil, fmt.Errorf("task not found")
	}

	return tasks[0], nil
}

// GetStats returns queue statistics
func (q *Queue) GetStats() (map[string]interface{}, error) {
	stats := make(map[string]interface{})

	// Count by status
	statusQuery := `
		SELECT status, COUNT(*) as count
		FROM task_queue
		GROUP BY status
	`

	rows, err := q.db.Query(statusQuery)
	if err != nil {
		return nil, fmt.Errorf("failed to query status stats: %w", err)
	}
	defer rows.Close()

	statusCounts := make(map[string]int)
	for rows.Next() {
		var status string
		var count int
		if err := rows.Scan(&status, &count); err == nil {
			statusCounts[status] = count
		}
	}
	stats["by_status"] = statusCounts

	// Count by model
	modelQuery := `
		SELECT model_name, COUNT(*) as count
		FROM task_queue
		WHERE status = 'pending'
		GROUP BY model_name
	`

	rows, err = q.db.Query(modelQuery)
	if err != nil {
		return nil, fmt.Errorf("failed to query model stats: %w", err)
	}
	defer rows.Close()

	modelCounts := make(map[string]int)
	for rows.Next() {
		var model string
		var count int
		if err := rows.Scan(&model, &count); err == nil {
			modelCounts[model] = count
		}
	}
	stats["pending_by_model"] = modelCounts

	return stats, nil
}

// DeleteCompletedTasks removes completed tasks older than the specified duration
func (q *Queue) DeleteCompletedTasks(olderThan time.Duration) (int64, error) {
	cutoff := time.Now().Add(-olderThan)

	query := `
		DELETE FROM task_queue
		WHERE status IN ('completed', 'failed') AND processed_at < ?
	`

	result, err := q.db.Exec(query, cutoff)
	if err != nil {
		return 0, fmt.Errorf("failed to delete completed tasks: %w", err)
	}

	count, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("failed to get affected rows: %w", err)
	}

	return count, nil
}

// scanTasks scans rows into Task structs
func (q *Queue) scanTasks(rows *sql.Rows) ([]*Task, error) {
	var tasks []*Task

	for rows.Next() {
		var task Task
		var metadataJSON, errorMessage sql.NullString
		var processedAt sql.NullTime

		err := rows.Scan(
			&task.ID, &task.TaskType, &task.ModelName, &task.Content,
			&metadataJSON, &task.Priority, &task.Status, &task.SessionID,
			&task.CreatedAt, &processedAt, &task.RetryCount, &errorMessage,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan task: %w", err)
		}

		if processedAt.Valid {
			task.ProcessedAt = &processedAt.Time
		}

		if errorMessage.Valid {
			task.ErrorMessage = &errorMessage.String
		}

		if metadataJSON.Valid && metadataJSON.String != "" {
			if err := json.Unmarshal([]byte(metadataJSON.String), &task.Metadata); err != nil {
				// Log error but don't fail the whole operation
				task.Metadata = nil
			}
		}

		tasks = append(tasks, &task)
	}

	return tasks, nil
}