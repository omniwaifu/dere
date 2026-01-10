# PostgreSQL with Apache AGE (graph) + pgvector (embeddings)
# AGE only supports up to PG17 as of 2026-01
FROM apache/age:release_PG17_1.6.0

# pgvector is in PGDG repos
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        postgresql-17-pgvector \
    && rm -rf /var/lib/apt/lists/*

# Enable extensions on database init
COPY init-extensions.sql /docker-entrypoint-initdb.d/
