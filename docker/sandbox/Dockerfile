# Sandbox container for running Claude Code in isolation
FROM python:3.13-slim

# Install system dependencies and Node.js
RUN apt-get update && apt-get install -y \
    git \
    curl \
    bash \
    unzip \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install Bun runtime
RUN curl -fsSL https://bun.sh/install | bash && \
    ln -s /root/.bun/bin/bun /usr/local/bin/bun && \
    ln -s /root/.bun/bin/bunx /usr/local/bin/bunx

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Create app directory
WORKDIR /app

# Copy dere repo (plugins, shared code, sandbox entrypoint)
COPY . /app/dere

# Install JS dependencies for SDK usage
WORKDIR /app/dere
RUN bun install --frozen-lockfile

WORKDIR /app
RUN chmod -R a+rX /app

# Create home directory writable by any UID (for --user mode)
RUN mkdir -p /home/user && chmod 777 /home/user

# Working directory for user projects (writable by any UID for --user mode)
RUN mkdir -p /workspace && chmod 777 /workspace
WORKDIR /workspace

# Entrypoint reads JSON commands from stdin, outputs JSON events to stdout
CMD ["bun", "/app/dere/docker/sandbox/entrypoint.ts"]
