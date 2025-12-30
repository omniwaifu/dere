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

- [ ] What structured outputs exist (AppraisalOutput, mission outputs, summaries)?
- [ ] Do we have JSON Schemas exported from Python (Pydantic -> JSON Schema)?
- [ ] Do we have TS types + validators generated (zod/valibot)?
- [ ] Is OpenAPI defined for daemon endpoints?
- [ ] Do we have a typed HTTP client for the daemon API?
- [ ] Do we have a typed client for dere_graph endpoints (`/kg` + `/search`)?

---

## Phase 2 — Shared tooling (LLM + config)

- [ ] Do we have a TS structured output wrapper (schema-first, retries, parsing)?
- [ ] Is _unwrap_tool_payload/JSON extraction ported to TS?
- [ ] Is there a TS prompt/tooling package with strict types + tests?
- [ ] Do we have schema conformance tests (golden fixtures)?
- [ ] Is dere_shared LLM client + structured output helpers ported?
- [ ] Are dere_shared emotion models + appraisal prompt builder ported?
- [ ] Is shared config loader + validation in TS (TOML -> typed)?
- [ ] Are shared task/mission schemas defined and serialized?

---

## Phase 3 — Graph boundary + persistence

- [ ] Which TS ORM will we use (Prisma/Drizzle/Kysely) and how will migrations run?
- [ ] Are SQLModel schemas mapped to TS types + migration scripts?
- [x] What is the integration boundary for dere_graph (REST/gRPC/queue)?
  - **Decision: HTTP boundary using existing `/kg/*` + `/search/*` endpoints** (treat graph as external service)
  - Contract should be versioned and stable to support later graph rewrite
- [ ] Have we verified the dere_graph client contract aligns with the boundary decision?

---

## Phase 4 — Daemon API surface (TS server)

- [ ] Do we have a TS HTTP server layer (Fastify/Express/Hono)?
- [ ] Are session lifecycle endpoints implemented (create/resume/context/summary)?
- [ ] Are work queue endpoints implemented?
- [ ] Are presence/router endpoints implemented?

---

## Phase 5 — Daemon services (highest LLM surface area)

- [ ] Is mission runner orchestration (agent service/executor) ported?
- [ ] Is context assembly + injection ported (session-start + prompt hooks)?
- [ ] Is summarization + session metadata updates ported?
- [ ] Is emotion appraisal pipeline ported (if kept in TS)?
- [ ] Is ambient monitor + analyzer ported (dere_ambient)?

---

## Phase 6 — Testing + CI

- [ ] Do we have TS lint/format/typecheck set up (eslint/prettier/tsc)?
- [ ] Are critical unit tests ported for LLM parsing/validation?
- [ ] Are integration tests in place for daemon + graph endpoints?
- [ ] Are end-to-end tests covering mission execution and ambient flow?

---

## Standardize TS replacements (answer alongside Phase 0/3)

- [x] FastAPI/uvicorn -> **Hono** (ultrafast, great Bun support)
- [ ] SQLAlchemy/SQLModel/asyncpg -> **Staying in Python for now** (dere_graph not migrating yet)
- [x] aiodocker -> **dockerode**
- [ ] croniter -> **node-cron** or **cron-parser** (TBD based on usage)
- [x] tomlkit -> **@iarna/toml**
- [x] tiktoken -> **tiktoken npm**
- [x] loguru -> **pino**
- [x] Pydantic -> **Zod** (schema validation and type inference)
- [x] LLM client -> **Claude Agent SDK for TS** (required for subscription access)
