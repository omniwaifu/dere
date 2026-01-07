# Filesystem Organization Refactoring Plan

## Overview

Refactor `packages/daemon/src/` from a flat 60+ file structure into a namespace-based organization to improve agentic tool navigation and context loading.

**Current State:**
- 60+ files in `daemon/src/` root
- `swarm.ts`: 3,123 lines
- `temporal/activities/index.ts`: 849 lines
- Related files scattered (ambient-*.ts, emotion-*.ts, mission-*.ts)

**Target State:**
- Namespace-based directories
- Files < 500 lines (ideally < 300)
- Clear domain boundaries

## Phase 1: Create Namespace Directories (Easy - IDE handles imports)

Create these directories:
- `ambient/` - ambient exploration system
- `emotions/` - emotion system
- `missions/` - mission system
- `sessions/` - session management
- `swarm/` - swarm orchestration
- `agents/` - agent management (optional, could stay at root)

## Phase 2: Move Ambient Files

**Files to move:**
- `ambient.ts` → `ambient/index.ts`
- `ambient-monitor.ts` → `ambient/monitor.ts`
- `ambient-analyzer.ts` → `ambient/analyzer.ts`
- `ambient-explorer.ts` → `ambient/explorer.ts`
- `ambient-config.ts` → `ambient/config.ts`
- `ambient-task-context.ts` → `ambient/task-context.ts`
- `ambient-triggers/` → `ambient/triggers/` (already a subdirectory, just move it)

**Action:** Use IDE "Move" refactoring (F2 or right-click → Move). IDE will update all imports automatically.

## Phase 3: Move Emotion Files

**Files to move:**
- `emotions.ts` → `emotions/index.ts`
- `emotion-manager.ts` → `emotions/manager.ts`
- `emotion-runtime.ts` → `emotions/runtime.ts`
- `emotion-physics.ts` → `emotions/physics.ts`
- `emotion-decay.ts` → `emotions/decay.ts`

**Action:** Use IDE "Move" refactoring.

## Phase 4: Move Mission Files

**Files to move:**
- `missions.ts` → `missions/index.ts`
- `mission-executor.ts` → `missions/executor.ts`
- `mission-runtime.ts` → `missions/runtime.ts`
- `mission-scheduler.ts` → `missions/scheduler.ts`
- `mission-schedule.ts` → `missions/schedule.ts`

**Action:** Use IDE "Move" refactoring.

## Phase 5: Move Session Files

**Files to move:**
- `sessions.ts` → `sessions/index.ts`
- `session-summary.ts` → `sessions/summary.ts`
- `conversations.ts` → `sessions/conversations.ts` (if session-related)

**Action:** Use IDE "Move" refactoring.

## Phase 6: Move Swarm Files

**Files to move:**
- `swarm.ts` → `swarm/index.ts` (temporary, will be split)
- `swarm-state.ts` → `swarm/state.ts`

**Action:** Use IDE "Move" refactoring.

**Note:** `swarm.ts` will be split in Phase 7, so this is just moving it to the namespace first.

## Phase 7: Split swarm.ts (3,123 lines → ~6 files)

**Current structure analysis:**
- Types and constants (lines 1-150)
- Core execution: `runSwarm`, `startSwarmExecution` (lines 1911-1978)
- Agent execution: `executeAutonomousAgent`, `executeAgentWithDependencies` (lines 1544-1703)
- Task management: `claimTaskForAgent`, `buildTaskPrompt` (lines 1491-1542)
- Synthesis: `synthesizeSwarmResults` (lines 1705-1870)
- HTTP routes: `registerSwarmRoutes` (lines 2152-3123)
- Git operations: `runGitCommand`, `getCurrentBranch` (lines 1980-2090)
- Cleanup: `cleanupOrphanedSwarms` (lines 2091-2150)

**Proposed split:**
1. `swarm/types.ts` - Types, constants, interfaces
2. `swarm/execution.ts` - Core execution (`runSwarm`, `startSwarmExecution`)
3. `swarm/agent-execution.ts` - Agent execution logic
4. `swarm/tasks.ts` - Task claiming and prompt building
5. `swarm/synthesis.ts` - Synthesis logic
6. `swarm/routes.ts` - HTTP route handlers
7. `swarm/git.ts` - Git operations
8. `swarm/cleanup.ts` - Cleanup functions
9. `swarm/index.ts` - Barrel export

**Action:** Manual split. Need to:
1. Identify all exports and their dependencies
2. Create new files with appropriate boundaries
3. Update imports in consuming files
4. Test that everything still works

## Phase 8: Split temporal/activities/index.ts (849 lines → 4-5 files)

**Current exports:**
- `getTaskById`, `claimTaskById`, `releaseTask`, `claimNextTask` - Task management
- `runExploration` - Core exploration logic
- `persistResult` - Result persistence
- `spawnFollowUps` - Follow-up task creation
- `storeFindings` - Findings storage
- `createGapTasks`, `createUnderexploredTasks` - Task creation

**Proposed split:**
1. `temporal/activities/tasks.ts` - Task CRUD operations
2. `temporal/activities/exploration.ts` - Exploration execution
3. `temporal/activities/results.ts` - Result persistence
4. `temporal/activities/followups.ts` - Follow-up creation
5. `temporal/activities/index.ts` - Barrel export

**Action:** Manual split similar to Phase 7.

## Phase 9: Rename Vague Files

**Files to rename:**
- `context.ts` → `prompt-context.ts` (if it's about prompt context) or `session-context.ts` (if session-related)
- Check if `misc.ts` or `types.ts` exist and rename appropriately

**Action:** Use IDE "Rename" refactoring (F2).

## Phase 10: Create Barrel Exports

Create `index.ts` files in each namespace directory to provide clean imports:

```typescript
// ambient/index.ts
export * from './monitor.js';
export * from './analyzer.js';
export * from './explorer.js';
// etc.
```

**Action:** Manual creation. This allows consumers to import from the namespace:
```typescript
import { startAmbientMonitor } from './ambient/index.js';
// instead of
import { startAmbientMonitor } from './ambient/monitor.js';
```

## Phase 11: Update Root Imports

Update files in `daemon/src/` root that import from moved files:
- `index.ts` - main entry point
- `app.ts` - route registration
- `trpc/router.ts` - tRPC routes
- Any other files that import moved modules

**Action:** IDE should handle most of this automatically, but verify.

## Testing Strategy

After each phase:
1. Run TypeScript compiler: `bun run build` (or equivalent)
2. Run tests if they exist
3. Start daemon and verify basic functionality

## Estimated Effort

- **Phases 1-6:** 30-60 minutes (mostly IDE automation)
- **Phase 7:** 2-4 hours (swarm.ts split requires understanding boundaries)
- **Phase 8:** 1-2 hours (activities split)
- **Phase 9:** 15 minutes
- **Phase 10:** 30 minutes
- **Phase 11:** 30 minutes

**Total:** 4-7 hours, mostly mechanical except for the splits.

## Benefits After Refactoring

1. **Agent Navigation:** Clear namespace boundaries help agents find related code
2. **Context Loading:** Smaller files (< 500 lines) load fully into context
3. **Human Readability:** Clear mental model of system organization
4. **Maintainability:** Easier to find and modify related functionality

## Notes

- Use IDE refactoring tools (F2 for rename, right-click → Move) to preserve import updates
- Test after each phase to catch issues early
- Consider creating a git branch for this refactoring
- The splits (Phases 7-8) are the real work; the moves are mechanical
