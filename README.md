# dere

Personality-layered wrapper for Claude Code with conversation persistence.

## Structure

```
src/
├── dere_cli/          # Main CLI wrapper
├── dere_daemon/       # Background processing
├── dere_discord/      # Discord bot
├── dere_obsidian/     # Obsidian integration
├── dere_ambient/      # Proactive monitoring
├── dere_graph/        # Knowledge graph
├── dere_shared/       # Shared utilities
└── dere_plugins/      # Claude Code plugins
    ├── dere_core/         # Core personality (always-on)
    ├── dere_productivity/ # Productivity suite (opt-in)
    ├── dere_code/         # Symbol-aware coding (auto)
    ├── dere_vault/        # Zettelkasten integration (opt-in)
    └── dere_graph_features/ # Knowledge graph features (auto)
```

## Install

```bash
git clone https://github.com/omniwaifu/dere.git
cd dere
just install
```

Requires Python 3.13+, [uv](https://github.com/astral-sh/uv), and [Claude CLI](https://github.com/anthropics/claude-cli).

## Build

```bash
just build      # Build with uv
just test       # Run tests
just lint       # Lint with ruff
just fmt        # Format code
```

## Plugins

dere uses a modular plugin architecture for Claude Code. Plugins are conditionally enabled based on context.

### dere-core (Always Active)

Core personality and environmental context. Always enabled.

**Features:**
- Tsundere personality tone
- Time, weather, and environmental context
- Emotion awareness (OCC model)
- Knowledge graph integration
- Conversation memory and recall
- Recent files tracking

**Skills:**
- `mood` - Query emotional state and adapt tone
- `recall` - Search conversation history and entity timeline

### dere-productivity (Opt-in)

Comprehensive productivity suite combining tasks, calendar, and activity tracking.

**Features:**
- GTD task management (Taskwarrior)
- Google Calendar integration
- ActivityWatch time tracking
- Intelligent scheduling and planning
- Daily planning/review rituals

**Skills:**
- `focus` - Find best next action for current context
- `inbox` - GTD inbox processing
- `calendar-context` - Show upcoming calendar events
- `schedule-event` - Create calendar events from natural language
- `activity-summary` - Daily/weekly productivity insights
- `focus-planning` - AI-powered task selection (considers calendar + activity + energy)
- `schedule-planning` - Optimal time blocking for tasks
- `morning-plan` - Guided daily planning ritual
- `evening-review` - End-of-day reflection and review

**Commands:**
- `/plan-day` - Start morning planning session
- `/review-day` - Start evening review session
- `/focus` - Quick task selection
- `/inbox` - Process inbox items
- `/habits` - Review habit tracking
- `/review` - Weekly GTD review

**Setup:**
```bash
# Enable productivity mode
dere --mode productivity

# Or configure in ~/.config/dere/config.toml:
[plugins.dere_productivity]
mode = "always"

[context]
tasks = true
activity = true
calendar = true
```

See [CALENDAR_SETUP.md](src/dere_plugins/dere_productivity/CALENDAR_SETUP.md) for Google Calendar OAuth setup.

### dere-code (Auto-enabled)

Symbol-aware coding workflows powered by Serena LSP and Context7 library docs.

**Features:**
- Symbol-level code navigation and refactoring
- Safe, verified refactorings (Find → Verify → Refactor → Test pattern)
- Codebase onboarding and architecture analysis
- Up-to-date library documentation queries
- Project knowledge base (patterns, decisions, footguns)

**Skills:**
- `symbol-navigator` - Use Serena's symbol tools for code exploration
- `refactoring-coordinator` - Safe symbol-level refactorings
- `code-structure-analyst` - Systematic codebase exploration
- `library-docs-navigator` - Query Context7 for library docs
- `project-knowledge-base` - Capture project-specific patterns

**Agents:**
- `feature-planner` - Read-only feature planning
- `cynical-reviewer` - Critical code review
- `implementation-engineer` - Code implementation with Serena tools
- `code-archeologist` - Deep codebase analysis

**Auto-enabled** in configured directories (default: `/mnt/data/Code`).

### dere-vault (Opt-in)

Obsidian vault integration for Zettelkasten workflows.

**Features:**
- Smart note creation and linking
- Backlink analysis
- Tag-based organization

**Enable:** `dere --mode vault` or when in Obsidian vault directory.

### dere-graph-features (Auto-enabled)

Knowledge graph visualization and output styles. Auto-enabled when daemon is running.

## Configuration

Config file: `~/.config/dere/config.toml`

```toml
[plugins.dere_core]
mode = "always"  # Always enabled

[plugins.dere_productivity]
mode = "never"  # "always", "never", or "auto"
directories = []

[plugins.dere_code]
mode = "auto"
directories = ["/mnt/data/Code"]

[plugins.dere_vault]
mode = "never"

[context]
# Core context (always injected)
time = true
weather = true
recent_files = true
knowledge_graph = true

# Productivity context (only when dere-productivity plugin enabled)
activity = true
tasks = true
calendar = true
```

## Context Injection

dere automatically injects contextual information into prompts based on which plugins are enabled. Context injection is **always on** - it's controlled by plugin/mode enablement, not a flag.

### Core Context (dere-core, always active)

Injected on every prompt when dere-core is enabled (which is always):

- **Time and Date**: Current time, date, day of week, timezone
- **Weather**: Location, conditions, temperature, humidity, pressure (if enabled in config)
- **Recent Files**: Files modified in the last hour in your working directory
- **Emotional State**: Current mood/emotion from OCC model (if daemon running)
- **Knowledge Graph**: Related entities and conversation context (if daemon running)
- **Conversation History**: Past relevant conversations with temporal context

### Productivity Context (dere-productivity, when enabled)

Injected only when productivity plugin is active (via `--mode productivity` or config):

- **Active Tasks**: Overdue, due today, due soon, and high-priority tasks from Taskwarrior
- **Recent Activity**: Recent apps and window titles from ActivityWatch with durations
- **Calendar Events**: Upcoming calendar events from Google Calendar (when configured)

### How Context is Controlled

- **Core context**: Controlled by individual flags in `[context]` section of config
- **Productivity context**: Only injected when `--mode productivity` or productivity plugin enabled via config
- **No --context flag**: Context injection happens automatically based on mode

## Usage Examples

```bash
# General use (core personality only)
dere

# Productivity mode (tasks + calendar + activity tracking)
dere --mode productivity

# Start day with planning
dere --mode productivity
> /plan-day

# End day with review
> /review-day

# Coding mode (symbol-aware tools)
dere --mode code
# Or auto-enabled in /mnt/data/Code

# Vault mode (Zettelkasten)
dere --mode vault
```

## Architecture

**Core Philosophy:**
- `dere-core`: Always-on personality (minimal, non-intrusive)
- Other plugins: Opt-in or auto-enabled based on context
- Separation of concerns: personality vs features
- Plugin orchestration: Skills can combine multiple data sources

**Data Flow:**
```
User → dere CLI → Plugins (conditional)
                 ├── dere-core (always)
                 ├── dere-productivity (opt-in)
                 │   ├── Taskwarrior MCP
                 │   ├── Google Calendar MCP
                 │   └── ActivityWatch
                 └── dere-code (auto)
                     ├── Serena MCP (LSP)
                     └── Context7 MCP (docs)
```
