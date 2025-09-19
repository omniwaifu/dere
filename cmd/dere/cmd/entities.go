package cmd

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"dere/src/database"

	"github.com/spf13/cobra"
)

var (
	entitiesLimit     int
	entitiesProject   string
	entitiesType      string
	entitiesFormat    string
	graphDepth        int
	showRelationships bool
)

// entitiesCmd represents the entities command
var entitiesCmd = &cobra.Command{
	Use:   "entities",
	Short: "Manage and explore extracted entities",
	Long: `Explore entities extracted from conversations using LLM-based semantic analysis.

Examples:
  dere entities list
  dere entities list --type=function
  dere entities graph React
  dere entities search "authentication"`,
}

// entitiesListCmd represents the entities list command
var entitiesListCmd = &cobra.Command{
	Use:   "list",
	Short: "List extracted entities",
	RunE: func(cmd *cobra.Command, args []string) error {
		db, err := getDatabase()
		if err != nil {
			return err
		}
		defer db.Close()

		entities, err := getEntities(db)
		if err != nil {
			return err
		}

		if len(entities) == 0 {
			fmt.Println("No entities found")
			return nil
		}

		// Group entities by type for better display
		entityGroups := make(map[string][]EntityDisplay)
		for _, entity := range entities {
			entityGroups[entity.Type] = append(entityGroups[entity.Type], entity)
		}

		// Sort types for consistent output
		var types []string
		for entityType := range entityGroups {
			types = append(types, entityType)
		}
		sort.Strings(types)

		fmt.Printf("Found %d entities:\n\n", len(entities))

		for _, entityType := range types {
			entities := entityGroups[entityType]
			fmt.Printf("📂 %s (%d):\n", strings.Title(entityType), len(entities))

			// Sort entities by confidence descending
			sort.Slice(entities, func(i, j int) bool {
				return entities[i].Confidence > entities[j].Confidence
			})

			for _, entity := range entities {
				confidenceBar := generateConfidenceBar(entity.Confidence)
				fmt.Printf("  • %s %s (%.1f%%)\n", entity.Value, confidenceBar, entity.Confidence*100)
				if showRelationships && len(entity.RelatedEntities) > 0 {
					fmt.Printf("    ↳ Related: %s\n", strings.Join(entity.RelatedEntities, ", "))
				}
			}
			fmt.Println()
		}

		return nil
	},
}

// entitiesGraphCmd represents the entities graph command
var entitiesGraphCmd = &cobra.Command{
	Use:   "graph [entity]",
	Short: "Display entity relationship graph",
	Args:  cobra.MaximumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		db, err := getDatabase()
		if err != nil {
			return err
		}
		defer db.Close()

		var centerEntity string
		if len(args) > 0 {
			centerEntity = args[0]
		}

		graph, err := getEntityGraph(db, centerEntity)
		if err != nil {
			return err
		}

		if len(graph.Nodes) == 0 {
			if centerEntity != "" {
				fmt.Printf("No entities found matching '%s'\n", centerEntity)
			} else {
				fmt.Println("No entity relationships found")
			}
			return nil
		}

		displayGraph(graph, centerEntity)

		return nil
	},
}

// entitiesSearchCmd represents the entities search command
var entitiesSearchCmd = &cobra.Command{
	Use:   "search <query>",
	Short: "Search entities by value or type",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		query := strings.ToLower(args[0])

		db, err := getDatabase()
		if err != nil {
			return err
		}
		defer db.Close()

		entities, err := searchEntities(db, query)
		if err != nil {
			return err
		}

		if len(entities) == 0 {
			fmt.Printf("No entities found matching '%s'\n", args[0])
			return nil
		}

		fmt.Printf("Found %d entities matching '%s':\n\n", len(entities), args[0])

		for _, entity := range entities {
			confidenceBar := generateConfidenceBar(entity.Confidence)
			fmt.Printf("🔍 %s (%s) %s\n", entity.Value, entity.Type, confidenceBar)
			if entity.ConversationID != nil {
				fmt.Printf("   💬 From conversation %d\n", *entity.ConversationID)
			}
			if len(entity.RelatedEntities) > 0 {
				fmt.Printf("   🔗 Related: %s\n", strings.Join(entity.RelatedEntities, ", "))
			}
			fmt.Println()
		}

		return nil
	},
}

// EntityDisplay represents an entity for display purposes
type EntityDisplay struct {
	ID              int64
	Type            string
	Value           string
	NormalizedValue string
	Confidence      float64
	ConversationID  *int64
	RelatedEntities []string
	CreatedAt       time.Time
}

// EntityGraph represents a graph of entities and their relationships
type EntityGraph struct {
	Nodes         []GraphNode
	Relationships []GraphRelationship
}

type GraphNode struct {
	ID         int64
	Value      string
	Type       string
	Confidence float64
}

type GraphRelationship struct {
	From         int64
	To           int64
	Type         string
	Confidence   float64
}

// getEntities retrieves entities from database with filtering
func getEntities(db *database.TursoDB) ([]EntityDisplay, error) {
	sqlDB := db.GetDB()

	query := `
		SELECT e.id, e.entity_type, e.entity_value, e.normalized_value,
		       e.confidence, e.conversation_id, e.created_at
		FROM entities e
	`
	args := []interface{}{}

	// Add filters
	var conditions []string

	if entitiesProject != "" {
		conditions = append(conditions, "s.working_dir = ?")
		args = append(args, entitiesProject)
		query = `
			SELECT e.id, e.entity_type, e.entity_value, e.normalized_value,
			       e.confidence, e.conversation_id, e.created_at
			FROM entities e
			JOIN sessions s ON e.session_id = s.id
		`
	}

	if entitiesType != "" {
		conditions = append(conditions, "e.entity_type = ?")
		args = append(args, entitiesType)
	}

	if len(conditions) > 0 {
		query += " WHERE " + strings.Join(conditions, " AND ")
	}

	query += " ORDER BY e.confidence DESC, e.created_at DESC LIMIT ?"
	args = append(args, entitiesLimit)

	rows, err := sqlDB.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query entities: %w", err)
	}
	defer rows.Close()

	var entities []EntityDisplay
	for rows.Next() {
		var entity EntityDisplay
		var conversationID *int64

		err := rows.Scan(&entity.ID, &entity.Type, &entity.Value, &entity.NormalizedValue,
			&entity.Confidence, &conversationID, &entity.CreatedAt)
		if err != nil {
			return nil, fmt.Errorf("failed to scan entity: %w", err)
		}

		entity.ConversationID = conversationID

		// Get related entities if requested
		if showRelationships {
			related, err := getRelatedEntities(sqlDB, entity.ID)
			if err == nil {
				entity.RelatedEntities = related
			}
		}

		entities = append(entities, entity)
	}

	return entities, nil
}

// getRelatedEntities gets entities related to the given entity ID
func getRelatedEntities(sqlDB interface{}, entityID int64) ([]string, error) {
	// This would query the entity_relationships table
	// For now, return empty slice
	return []string{}, nil
}

// getEntityGraph builds a graph of entity relationships
func getEntityGraph(db *database.TursoDB, centerEntity string) (*EntityGraph, error) {
	sqlDB := db.GetDB()

	graph := &EntityGraph{}

	// Get entities (optionally filtered by center entity)
	var entityQuery string
	var entityArgs []interface{}

	if centerEntity != "" {
		entityQuery = `
			SELECT id, entity_type, entity_value, confidence
			FROM entities
			WHERE entity_value LIKE ? OR normalized_value LIKE ?
			ORDER BY confidence DESC
			LIMIT 20
		`
		pattern := "%" + strings.ToLower(centerEntity) + "%"
		entityArgs = []interface{}{pattern, pattern}
	} else {
		entityQuery = `
			SELECT id, entity_type, entity_value, confidence
			FROM entities
			ORDER BY confidence DESC
			LIMIT 50
		`
	}

	rows, err := sqlDB.Query(entityQuery, entityArgs...)
	if err != nil {
		return nil, fmt.Errorf("failed to query entities: %w", err)
	}
	defer rows.Close()

	entityIDs := []int64{}
	for rows.Next() {
		var node GraphNode
		err := rows.Scan(&node.ID, &node.Type, &node.Value, &node.Confidence)
		if err != nil {
			continue
		}
		graph.Nodes = append(graph.Nodes, node)
		entityIDs = append(entityIDs, node.ID)
	}

	// Get relationships for these entities
	if len(entityIDs) > 0 {
		placeholders := strings.Repeat("?,", len(entityIDs))
		placeholders = placeholders[:len(placeholders)-1] // Remove trailing comma

		relQuery := fmt.Sprintf(`
			SELECT entity_1_id, entity_2_id, relationship_type, confidence
			FROM entity_relationships
			WHERE entity_1_id IN (%s) OR entity_2_id IN (%s)
		`, placeholders, placeholders)

		// Duplicate entity IDs for both IN clauses
		relArgs := make([]interface{}, len(entityIDs)*2)
		for i, id := range entityIDs {
			relArgs[i] = id
			relArgs[i+len(entityIDs)] = id
		}

		relRows, err := sqlDB.Query(relQuery, relArgs...)
		if err == nil {
			defer relRows.Close()

			for relRows.Next() {
				var rel GraphRelationship
				err := relRows.Scan(&rel.From, &rel.To, &rel.Type, &rel.Confidence)
				if err != nil {
					continue
				}
				graph.Relationships = append(graph.Relationships, rel)
			}
		}
	}

	return graph, nil
}

// searchEntities searches for entities by value or type
func searchEntities(db *database.TursoDB, query string) ([]EntityDisplay, error) {
	sqlDB := db.GetDB()

	searchQuery := `
		SELECT e.id, e.entity_type, e.entity_value, e.normalized_value,
		       e.confidence, e.conversation_id, e.created_at
		FROM entities e
		WHERE LOWER(e.entity_value) LIKE ?
		   OR LOWER(e.normalized_value) LIKE ?
		   OR LOWER(e.entity_type) LIKE ?
		ORDER BY e.confidence DESC
		LIMIT ?
	`

	pattern := "%" + query + "%"
	rows, err := sqlDB.Query(searchQuery, pattern, pattern, pattern, entitiesLimit)
	if err != nil {
		return nil, fmt.Errorf("failed to search entities: %w", err)
	}
	defer rows.Close()

	var entities []EntityDisplay
	for rows.Next() {
		var entity EntityDisplay
		var conversationID *int64

		err := rows.Scan(&entity.ID, &entity.Type, &entity.Value, &entity.NormalizedValue,
			&entity.Confidence, &conversationID, &entity.CreatedAt)
		if err != nil {
			continue
		}

		entity.ConversationID = conversationID
		entities = append(entities, entity)
	}

	return entities, nil
}

// displayGraph displays the entity graph in ASCII format
func displayGraph(graph *EntityGraph, centerEntity string) {
	if centerEntity != "" {
		fmt.Printf("🌐 Entity Graph for '%s':\n\n", centerEntity)
	} else {
		fmt.Println("🌐 Entity Relationship Graph:\n")
	}

	// Create a map for quick node lookup
	nodeMap := make(map[int64]GraphNode)
	for _, node := range graph.Nodes {
		nodeMap[node.ID] = node
	}

	// Display nodes
	fmt.Println("📍 Entities:")
	for _, node := range graph.Nodes {
		confidenceBar := generateConfidenceBar(node.Confidence)
		fmt.Printf("  [%d] %s (%s) %s\n", node.ID, node.Value, node.Type, confidenceBar)
	}

	if len(graph.Relationships) > 0 {
		fmt.Println("\n🔗 Relationships:")
		for _, rel := range graph.Relationships {
			fromNode, fromOk := nodeMap[rel.From]
			toNode, toOk := nodeMap[rel.To]

			if fromOk && toOk {
				confidenceBar := generateConfidenceBar(rel.Confidence)
				fmt.Printf("  %s → %s → %s %s\n",
					fromNode.Value, rel.Type, toNode.Value, confidenceBar)
			}
		}
	} else {
		fmt.Println("\n🔗 No relationships found")
	}
}

// generateConfidenceBar creates a visual confidence indicator
func generateConfidenceBar(confidence float64) string {
	bars := int(confidence * 10)
	if bars > 10 {
		bars = 10
	}
	if bars < 0 {
		bars = 0
	}

	filled := strings.Repeat("█", bars)
	empty := strings.Repeat("░", 10-bars)

	return fmt.Sprintf("[%s%s]", filled, empty)
}

func init() {
	rootCmd.AddCommand(entitiesCmd)
	entitiesCmd.AddCommand(entitiesListCmd)
	entitiesCmd.AddCommand(entitiesGraphCmd)
	entitiesCmd.AddCommand(entitiesSearchCmd)

	// Flags for list command
	entitiesListCmd.Flags().IntVar(&entitiesLimit, "limit", 50, "Number of entities to show")
	entitiesListCmd.Flags().StringVar(&entitiesProject, "project", "", "Filter by project path")
	entitiesListCmd.Flags().StringVar(&entitiesType, "type", "", "Filter by entity type")
	entitiesListCmd.Flags().BoolVar(&showRelationships, "relationships", false, "Show related entities")

	// Flags for graph command
	entitiesGraphCmd.Flags().IntVar(&graphDepth, "depth", 2, "Maximum relationship depth to explore")

	// Flags for search command
	entitiesSearchCmd.Flags().IntVar(&entitiesLimit, "limit", 20, "Number of results to show")
}