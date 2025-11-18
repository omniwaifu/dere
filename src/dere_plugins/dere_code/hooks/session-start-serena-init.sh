#!/usr/bin/env bash
# Session Start: Serena Activation & Context Loading
# Automatically activates Serena and loads previous session context

set -euo pipefail

# Detect project language from marker files
# Workaround for Serena bug: file-count detection can misidentify Rust as TypeScript
# if there are more JS/TS files (config, tooling) than .rs files
DETECTED_LANGUAGE=""

if [ -f "Cargo.toml" ]; then
  DETECTED_LANGUAGE="rust"
elif [ -f "go.mod" ]; then
  DETECTED_LANGUAGE="go"
elif [ -f "pyproject.toml" ] || [ -f "setup.py" ]; then
  DETECTED_LANGUAGE="python"
elif [ -f "package.json" ]; then
  # TypeScript is used for both TS and JS projects (JS uses typescript LSP)
  if [ -f "tsconfig.json" ] || [ -f "deno.json" ] || [ -f "deno.jsonc" ]; then
    DETECTED_LANGUAGE="typescript"
  else
    DETECTED_LANGUAGE="typescript"
  fi
elif [ -f "pom.xml" ] || [ -f "build.gradle" ] || [ -f "build.gradle.kts" ]; then
  DETECTED_LANGUAGE="java"
elif compgen -G "*.gemspec" > /dev/null 2>&1 || [ -f "Gemfile" ]; then
  DETECTED_LANGUAGE="ruby"
elif [ -f "composer.json" ]; then
  DETECTED_LANGUAGE="php"
elif compgen -G "*.csproj" > /dev/null 2>&1 || compgen -G "*.sln" > /dev/null 2>&1; then
  DETECTED_LANGUAGE="csharp"
elif [ -f "mix.exs" ]; then
  DETECTED_LANGUAGE="elixir"
elif compgen -G "*.cabal" > /dev/null 2>&1 || [ -f "stack.yaml" ]; then
  DETECTED_LANGUAGE="haskell"
elif [ -f "CMakeLists.txt" ] || [ -f "Makefile" ]; then
  # C/C++ both use cpp LSP in Serena
  DETECTED_LANGUAGE="cpp"
fi

# Only activate for code projects
if [ -d ".serena" ] || [ -f "package.json" ] || [ -f "pyproject.toml" ] || [ -f "Cargo.toml" ] || [ -f "go.mod" ]; then
  cat << 'PROMPT'
🔧 Code Project Detected - Serena Available

IMPORTANT: Before ANY code operations:
1. Project automatically activates via Serena MCP
2. check_onboarding_performed()
   → If NOT done: Run onboarding() workflow
   → If done: list_memories() and load relevant ones

Previous session knowledge persists in .serena/memories/
Claude Code 1.0.52+ automatically loads Serena instructions.
PROMPT

  # Add language hint if detected
  if [ -n "$DETECTED_LANGUAGE" ]; then
    cat << LANGUAGE_HINT

⚠️  LANGUAGE DETECTION HINT:
Project marker files suggest this is a $DETECTED_LANGUAGE project.
After onboarding completes, verify the 'languages:' field in .serena/project.yml
is set to [$DETECTED_LANGUAGE] (not typescript or another incorrect language).
LANGUAGE_HINT
  fi
fi
