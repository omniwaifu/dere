# TODO — TypeScript Migration Checklist

Goal: improve type rigor, tooling, and LLM authoring quality by moving daemon/graph/shared pieces to TS while keeping Python infrastructure stable where it makes sense.

---

## Phase 0 — Decisions (answer first)

- [x] What is the migration scope (daemon + shared libs, graph boundary only)?
  - **Daemon + shared libs only** (dere_graph stays in Python for now, possible future migration)
- [x] What is explicitly out of scope (MCP servers, plugins, UI, Discord)?
  - **MCP servers, plugins system, Discord bot** (all stay in Python)
- [x] What are the success criteria (type safety, dev UX, latency, failure rate)?
  - **Type safety for LLM interactions** (catch schema/prompt errors at compile time)
  - **Better dev UX** (IDE autocomplete, refactoring confidence)
  - **Easier for LLM to reason about** when adding new features
- [x] What TS runtime and deployment model will we use?
  - **Bun** (fast, native TS, built-in bundler/test runner)
- [x] What repo structure will we use (mono-repo packages vs apps/)?
  - **packages/ monorepo** (packages/daemon, packages/shared-llm, packages/shared-config)
  - Use Bun workspaces for dependency management
- [x] What Python components stay (graph storage, migrations, etc.)?
  - **dere_graph** (SQLModel/SQLAlchemy ORM and storage layer)
  - **Database migrations** (Alembic scripts)
  - **MCP servers** (existing Python implementation)
  - **Plugins infrastructure** (existing Python implementation)
  - Note: graph/DB might migrate to TS later if beneficial
- [x] Which TS equivalents will we standardize on for core deps?
  - **HTTP Server**: Hono (ultrafast, great Bun support, simple API)
  - **Schema/Validation**: Zod (replacing Pydantic)
  - **Config Parser**: @iarna/toml (replacing tomlkit)
  - **Logging**: Pino (replacing loguru, structured JSON logging)
  - **Docker**: dockerode (replacing aiodocker)
  - **Token counting**: tiktoken npm (replacing tiktoken Python)
- [x] Which LLM client path do we use (TS SDK vs direct API)?
  - **Claude Agent SDK for TS** (required for subscription/Claude Code calls without extra cost)

---

## Phase 1 — Contracts and schema source of truth

- [x] What structured outputs exist (AppraisalOutput, mission outputs, summaries)?
  - **AppraisalOutput** (emotion appraisal): `src/dere_shared/emotion/models.py`
  - **AmbientEngagementDecision**: `src/dere_shared/models.py`
  - **AmbientMissionDecision**: `src/dere_shared/models.py`
  - **ExplorationOutput** (ambient curiosity): `src/dere_shared/llm_schemas.py`
  - **ScheduleParseResult** (cron parser): `src/dere_shared/llm_schemas.py`
  - **SessionTitleResult** (session naming): `src/dere_shared/llm_schemas.py`
- [x] Do we have JSON Schemas exported from Python (Pydantic -> JSON Schema)?
  - **Export script**: `scripts/export_schemas.py` → `schemas/llm/*.schema.json`
  - **Config schema export**: `scripts/export_schemas.py` → `schemas/config/dere_config.schema.json`
- [x] Do we have TS types + validators generated (zod/valibot)?
  - **LLM schemas in Zod**: `packages/shared-llm/src/schemas.ts`
  - **Config typegen pipeline**: `package.json` script `gen:config-types` (JSON Schema → TS)
- [x] Is OpenAPI defined for daemon endpoints?
  - **FastAPI OpenAPI export**: `scripts/export_openapi.py` → `schemas/openapi/dere_daemon.openapi.json`
- [x] Do we have a typed HTTP client for the daemon API?
  - **Client scaffold + OpenAPI typegen**: `packages/daemon-client`
  - Run `bun run gen:openapi` after exporting OpenAPI to generate `src/openapi.ts`
- [x] Do we have a typed client for dere_graph endpoints (`/kg` + `/search`)?
  - **Covered via daemon OpenAPI** once `/kg` routes are included in `schemas/openapi/dere_daemon.openapi.json`

---

## Phase 2 — Shared tooling (LLM + config)

- [x] Do we have a TS structured output wrapper (schema-first, retries, parsing)?
  - **Structured output client + parsing**: `packages/shared-llm/src/client.ts`
- [x] Is \_unwrap_tool_payload/JSON extraction ported to TS?
  - **Shared helpers**: `packages/shared-llm/src/structured-output.ts`
- [x] Is there a TS prompt/tooling package with strict types + tests?
  - **XML prompt helpers + tests**: `packages/shared-llm/src/xml-utils.ts`, `packages/shared-llm/src/xml-utils.test.ts`
- [x] Do we have schema conformance tests (golden fixtures)?
  - **Basic conformance tests**: `packages/shared-llm/src/structured-output.test.ts`
- [x] Is dere_shared LLM client + structured output helpers ported?
  - **Generic client + Claude Agent SDK transport**: `packages/shared-llm/src/client.ts`, `packages/shared-llm/src/claude-agent-transport.ts`
  - Note: auth/session isolation parity still pending vs Python `ClaudeClient`
- [x] Are dere_shared emotion models + appraisal prompt builder ported?
  - **OCC types + prompt builder**: `packages/shared-llm/src/emotion.ts`
  - **Zod schemas for appraisal output** live in `packages/shared-llm/src/schemas.ts`
- [x] Is shared config loader + validation in TS (TOML -> typed)?
  - **JSON schema → Zod validation**: `packages/shared-config/src/schema.ts`
  - **Config loader**: `packages/shared-config/src/index.ts`
- [x] Are shared task/mission schemas defined and serialized?
  - **Shared Zod schemas**: `packages/shared-llm/src/task-schemas.ts`

---

## Phase 3 — Graph boundary + persistence

- [x] Which TS ORM will we use (Prisma/Drizzle/Kysely) and how will migrations run?
  - **Kysely** for TS daemon DB access; **Alembic** remains for migrations (Python)
- [x] Are SQLModel schemas mapped to TS types + migration scripts?
  - **Kysely DB types expanded**: `packages/daemon/src/db-types.ts` (entities, context_cache, swarms, scratchpad)
- [x] What is the integration boundary for dere_graph (REST/gRPC/queue)?
  - **Decision: HTTP boundary using existing `/kg/*` + `/search/*` endpoints** (treat graph as external service)
  - Contract should be versioned and stable to support later graph rewrite
- [x] Have we verified the dere_graph client contract aligns with the boundary decision?
  - **OpenAPI includes `/kg/*` endpoints** and is consumed by `packages/daemon-client`

---

## Phase 4 — Daemon API surface (TS server)

- [x] Do we have a TS HTTP server layer (Fastify/Express/Hono)?
  - **Hono + Bun scaffold**: `packages/daemon/src/index.ts`
  - **Implemented endpoints**: `/config`, `/config/schema`, `/agent/models`, `/agent/output-styles`, `/agent/personalities`
- [x] Are session lifecycle endpoints implemented (create/resume/context/summary)?
  - **Implemented in TS daemon**: `packages/daemon/src/sessions.ts`
- [x] Are agent session endpoints fully implemented (create/update/delete + messages)?
  - **Read + mutation endpoints implemented**: `packages/daemon/src/agent.ts`
  - **Optional proxy** for mutations via `DERE_AGENT_PROXY=1`
- [x] Are work queue endpoints implemented?
  - **Implemented in TS daemon**: `packages/daemon/src/work-queue.ts`
- [x] Are presence/router endpoints implemented?
  - **Presence endpoints implemented in TS daemon**: `packages/daemon/src/presence.ts`
- [x] Are ambient dashboard endpoints implemented?
  - **Ambient dashboard endpoint implemented in TS daemon**: `packages/daemon/src/ambient.ts`
- [x] Are core memory endpoints implemented (edit/list/history/rollback + consolidation runs)?
  - **Implemented in TS daemon**: `packages/daemon/src/core-memory.ts`

---

## Phase 5 — Daemon services (highest LLM surface area)

- [x] Is mission runner orchestration (agent service/executor) ported?
  - **Mission executor + scheduler + routes**: `packages/daemon/src/mission-executor.ts`, `packages/daemon/src/mission-scheduler.ts`, `packages/daemon/src/missions.ts`
- [x] Is context assembly + injection ported (session-start + prompt hooks)?
  - **Context XML builder**: `packages/daemon/src/prompt-context.ts` (personality + core memory + env + emotion)
- [x] Is summarization + session metadata updates ported?
  - **Idle session summaries + summary_context rollup + core memory updates**: `packages/daemon/src/session-summary.ts`
- [x] Is emotion appraisal pipeline ported (if kept in TS)?
  - **Batch appraisal + decay loop + runtime wiring**: `packages/daemon/src/emotion-manager.ts`, `packages/daemon/src/emotion-runtime.ts`
- [x] Is memory consolidation loop ported (queue + summaries + run tracking)?
  - **Task queue processing + summary blocks + run tracking**: `packages/daemon/src/memory-consolidation.ts`
- [x] Is ambient monitor + analyzer ported (now in TS daemon)?
  - **Monitor + analyzer + FSM**: `packages/daemon/src/ambient-monitor.ts`, `packages/daemon/src/ambient-analyzer.ts`, `packages/daemon/src/ambient-fsm.ts`
  - **Exploration + curiosity triggers**: `packages/daemon/src/ambient-explorer.ts`, `packages/daemon/src/ambient-triggers/*`
  - **Note**: exploration now uses TS endpoints for ActivityWatch/Taskwarrior/emotion; KG/entity search still uses Python `/kg` + `/search`

---

## Phase 6 — Testing + CI

- [x] Do we have TS lint/format/typecheck set up (eslint/prettier/tsc)?
- [x] Are critical unit tests ported for LLM parsing/validation?
  - **Shared LLM parsing tests**: `packages/shared-llm/src/structured-output.test.ts`
- [x] Are integration tests in place for daemon + graph endpoints?
- [x] Are end-to-end tests covering mission execution and ambient flow?

---

## Standardize TS replacements (answer alongside Phase 0/3)

- [x] FastAPI/uvicorn -> **Hono** (ultrafast, great Bun support)
- [x] SQLAlchemy/SQLModel/asyncpg -> **Staying in Python for now** (dere_graph migration deferred)
- [x] aiodocker -> **dockerode**
- [x] croniter -> **cron-parser** (used in `packages/daemon/src/mission-schedule.ts`)
- [x] tomlkit -> **@iarna/toml**
- [x] tiktoken -> **tiktoken npm**
- [x] loguru -> **pino**
- [x] Pydantic -> **Zod** (schema validation and type inference)
- [x] LLM client -> **Claude Agent SDK for TS** (required for subscription access)
