-- Enable vector similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- Enable graph database (Apache AGE)
CREATE EXTENSION IF NOT EXISTS age;

-- Load AGE into search path for this session
-- Note: Applications must also run LOAD 'age' per connection
LOAD 'age';
SET search_path = ag_catalog, "$user", public;

-- Create the knowledge graph
SELECT create_graph('dere_graph');
