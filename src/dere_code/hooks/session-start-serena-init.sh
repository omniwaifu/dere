#!/usr/bin/env bash
# Session Start: Knowledge Loading (Rules + Serena)
# Reports both knowledge sources and guides activation

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
  DETECTED_LANGUAGE="cpp"
fi

# Check for Claude Code rules (always reliable)
RULES_COUNT=0
if [ -d ".claude/rules" ]; then
  RULES_COUNT=$(find .claude/rules -name "*.md" 2>/dev/null | wc -l)
fi

# Check for Serena project markers
SERENA_AVAILABLE=""
if [ -d ".serena" ] || [ -f "package.json" ] || [ -f "pyproject.toml" ] || [ -f "Cargo.toml" ] || [ -f "go.mod" ]; then
  SERENA_AVAILABLE="yes"
fi

# Output based on what's available
if [ "$RULES_COUNT" -gt 0 ] && [ -n "$SERENA_AVAILABLE" ]; then
  cat << PROMPT
Code Project - Dual Knowledge System

RULES (auto-loaded, ${RULES_COUNT} files):
- Static conventions in .claude/rules/ already active
- Path-scoped rules apply to matching directories

SERENA (dynamic memories):
- check_onboarding_performed()
  -> If NOT done: Run onboarding()
  -> If done: list_memories() and load relevant ones

Rules = reliable foundation | Serena = session discoveries
PROMPT

elif [ "$RULES_COUNT" -gt 0 ]; then
  cat << PROMPT
Code Project - Rules Available

${RULES_COUNT} rule files in .claude/rules/ are loaded.
Static conventions are active.

No Serena project detected. Dynamic memory unavailable.
(To enable: /workspace-init will set up Serena)
PROMPT

elif [ -n "$SERENA_AVAILABLE" ]; then
  cat << 'PROMPT'
Code Project - Serena Available

IMPORTANT: Before ANY code operations:
1. check_onboarding_performed()
   -> If NOT done: Run onboarding()
   -> If done: list_memories() and load relevant ones

Tip: Consider adding static conventions to .claude/rules/ for reliability.
Previous session knowledge persists in .serena/memories/
PROMPT
fi

# Add language hint if detected
if [ -n "$DETECTED_LANGUAGE" ] && [ -n "$SERENA_AVAILABLE" ]; then
  cat << LANGUAGE_HINT

LANGUAGE HINT: Project markers suggest $DETECTED_LANGUAGE.
After onboarding, verify 'languages:' in .serena/project.yml is correct.
LANGUAGE_HINT
fi
