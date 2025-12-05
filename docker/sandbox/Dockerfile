# Sandbox container for running Claude Code in isolation
FROM python:3.13-slim

# Install system dependencies and Node.js
RUN apt-get update && apt-get install -y \
    git \
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Create app directory
WORKDIR /app

# Copy dere package for installation (plugins, shared code)
COPY . /app/dere

# Install dere-graph (workspace dependency) then dere package
RUN pip install /app/dere/src/dere_graph && pip install /app/dere

# Copy entrypoint
COPY docker/sandbox/entrypoint.py /app/entrypoint.py
RUN chmod 755 /app/entrypoint.py && chmod -R a+rX /app

# Working directory for user projects (writable by any UID for keep-id mode)
RUN mkdir -p /workspace && chmod 777 /workspace
WORKDIR /workspace

# Entrypoint reads JSON commands from stdin, outputs JSON events to stdout
CMD ["python3", "/app/entrypoint.py"]
