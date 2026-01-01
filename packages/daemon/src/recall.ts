import type { Hono } from "hono";
import { sql } from "kysely";

import { getDb } from "./db.js";
import { getRecallEmbedder, vectorLiteral } from "./recall-embeddings.js";

type RecallResult = {
  result_id: string;
  result_type: "conversation" | "exploration_finding";
  score: number;
  text: string;
  timestamp: number;
  user_id: string | null;
  message_type?: string | null;
  medium?: string | null;
  session_id?: number | null;
  conversation_id?: number | null;
  block_id?: number | null;
  finding_id?: number | null;
  task_id?: number | null;
  confidence?: number | null;
};

function rrfScores(resultLists: string[][], rankConst = 60): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const results of resultLists) {
    results.forEach((id, idx) => {
      scores[id] = (scores[id] ?? 0) + 1.0 / (idx + rankConst);
    });
  }
  return scores;
}

function toNumber(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function parseJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

export function registerRecallRoutes(app: Hono): void {
  app.get("/recall/search", async (c) => {
    const query = c.req.query("query") ?? "";
    if (!query.trim()) {
      return c.json({ query, results: [] });
    }

    const limit = Math.max(1, toNumber(c.req.query("limit"), 10));
    const daysBack = c.req.query("days_back");
    const sessionId = c.req.query("session_id");
    const userId = c.req.query("user_id");

    const cutoffSeconds =
      daysBack && Number(daysBack) > 0
        ? Math.floor(Date.now() / 1000) - Number(daysBack) * 86400
        : null;
    const cutoffDate =
      daysBack && Number(daysBack) > 0
        ? new Date(Date.now() - Number(daysBack) * 86400 * 1000)
        : null;

    const db = await getDb();

    let convoQuery = db
      .selectFrom("conversation_blocks as cb")
      .innerJoin("conversations as c", "c.id", "cb.conversation_id")
      .select([
        "cb.id as block_id",
        "cb.text as text",
        "c.id as conversation_id",
        "c.session_id as session_id",
        "c.message_type as message_type",
        "c.timestamp as timestamp",
        "c.medium as medium",
        "c.user_id as user_id",
        sql<number>`ts_rank_cd(to_tsvector('english', cb.text), websearch_to_tsquery('english', ${query}))`.as(
          "score",
        ),
      ])
      .where("cb.block_type", "=", "text")
      .where("cb.text", "is not", null)
      .where(sql`cb.text <> ''`)
      .where("c.message_type", "in", ["user", "assistant", "system"])
      .where(sql`to_tsvector('english', cb.text) @@ websearch_to_tsquery('english', ${query})`)
      .orderBy("score", "desc")
      .limit(limit * 2);

    if (sessionId && Number.isFinite(Number(sessionId))) {
      convoQuery = convoQuery.where("c.session_id", "=", Number(sessionId));
    }
    if (userId) {
      convoQuery = convoQuery.where("c.user_id", "=", userId);
    }
    if (cutoffSeconds !== null) {
      convoQuery = convoQuery.where("c.timestamp", ">=", cutoffSeconds);
    }

    const fulltextRows = await convoQuery.execute();
    const fulltextIds = fulltextRows.map((row) => `conv:${row.block_id}`);

    let vectorRows: typeof fulltextRows = [];
    let vectorIds: string[] = [];
    const embedder = await getRecallEmbedder();
    if (embedder) {
      try {
        const queryEmbedding = await embedder.create(query.replace(/\n/g, " "));
        const vector = vectorLiteral(queryEmbedding);

        let vectorQuery = db
          .selectFrom("conversation_blocks as cb")
          .innerJoin("conversations as c", "c.id", "cb.conversation_id")
          .select([
            "cb.id as block_id",
            "cb.text as text",
            "c.id as conversation_id",
            "c.session_id as session_id",
            "c.message_type as message_type",
            "c.timestamp as timestamp",
            "c.medium as medium",
            "c.user_id as user_id",
            sql<number>`1 - (cb.content_embedding <=> ${vector}::vector)`.as("score"),
          ])
          .where("cb.block_type", "=", "text")
          .where("cb.text", "is not", null)
          .where(sql`cb.text <> ''`)
          .where("c.message_type", "in", ["user", "assistant", "system"])
          .where("cb.content_embedding", "is not", null)
          .orderBy(sql`cb.content_embedding <=> ${vector}::vector`)
          .limit(limit * 2);

        if (sessionId && Number.isFinite(Number(sessionId))) {
          vectorQuery = vectorQuery.where("c.session_id", "=", Number(sessionId));
        }
        if (userId) {
          vectorQuery = vectorQuery.where("c.user_id", "=", userId);
        }
        if (cutoffSeconds !== null) {
          vectorQuery = vectorQuery.where("c.timestamp", ">=", cutoffSeconds);
        }

        vectorRows = await vectorQuery.execute();
        vectorIds = vectorRows.map((row) => `conv:${row.block_id}`);
      } catch (error) {
        console.log(`[recall] vector search failed: ${String(error)}`);
      }
    }

    const surfacedCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const surfacedClause =
      sessionId && Number.isFinite(Number(sessionId))
        ? sql`not exists (select 1 from surfaced_findings sf where sf.finding_id = f.id and (sf.surfaced_at > ${surfacedCutoff} or sf.session_id = ${Number(sessionId)}))`
        : sql`not exists (select 1 from surfaced_findings sf where sf.finding_id = f.id and sf.surfaced_at > ${surfacedCutoff})`;

    let findingQuery = db
      .selectFrom("exploration_findings as f")
      .select([
        "f.id as finding_id",
        "f.task_id as task_id",
        "f.finding as text",
        "f.share_message as share_message",
        "f.worth_sharing as worth_sharing",
        "f.user_id as user_id",
        "f.confidence as confidence",
        "f.created_at as created_at",
        sql<number>`ts_rank_cd(to_tsvector('english', f.finding), websearch_to_tsquery('english', ${query}))`.as(
          "score",
        ),
      ])
      .where(sql`f.finding <> ''`)
      .where(surfacedClause)
      .where(sql`to_tsvector('english', f.finding) @@ websearch_to_tsquery('english', ${query})`)
      .orderBy("score", "desc")
      .limit(limit * 2);

    if (userId) {
      findingQuery = findingQuery.where("f.user_id", "=", userId);
    }
    if (cutoffDate) {
      findingQuery = findingQuery.where("f.created_at", ">=", cutoffDate);
    }

    const findingRows = await findingQuery.execute();
    const findingIds = findingRows.map((row) => `finding:${row.finding_id}`);

    const scores = rrfScores([fulltextIds, vectorIds, findingIds]);
    const ranked = Object.keys(scores)
      .sort((a, b) => scores[b] - scores[a])
      .slice(0, limit);

    const rowMap = new Map<string, Record<string, unknown>>();
    for (const row of fulltextRows) {
      rowMap.set(`conv:${row.block_id}`, row as Record<string, unknown>);
    }
    for (const row of vectorRows) {
      rowMap.set(`conv:${row.block_id}`, row as Record<string, unknown>);
    }
    for (const row of findingRows) {
      rowMap.set(`finding:${row.finding_id}`, row as Record<string, unknown>);
    }

    const results: RecallResult[] = [];
    for (const resultId of ranked) {
      const row = rowMap.get(resultId);
      if (!row) {
        continue;
      }
      if (resultId.startsWith("conv:")) {
        results.push({
          result_id: resultId,
          result_type: "conversation",
          block_id: row.block_id as number,
          conversation_id: row.conversation_id as number,
          session_id: row.session_id as number,
          message_type: row.message_type as string,
          timestamp: row.timestamp as number,
          medium: row.medium as string | null,
          user_id: row.user_id as string | null,
          text: String(row.text ?? ""),
          score: scores[resultId] ?? 0,
        });
      } else {
        const createdAt = row.created_at instanceof Date ? row.created_at : null;
        const timestamp = createdAt ? Math.floor(createdAt.getTime() / 1000) : 0;
        const displayText = row.worth_sharing && row.share_message ? row.share_message : row.text;
        results.push({
          result_id: resultId,
          result_type: "exploration_finding",
          finding_id: row.finding_id as number,
          task_id: row.task_id as number,
          user_id: row.user_id as string | null,
          text: String(displayText ?? ""),
          timestamp,
          message_type: "exploration",
          confidence: (row.confidence as number | null) ?? null,
          score: scores[resultId] ?? 0,
        });
      }
    }

    return c.json({ query, results });
  });

  app.post("/recall/findings/surface", async (c) => {
    const payload = await parseJson<Record<string, unknown>>(c.req.raw);
    if (!payload) {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const findingId = typeof payload.finding_id === "number" ? payload.finding_id : null;
    if (!findingId) {
      return c.json({ error: "finding_id is required" }, 400);
    }

    const sessionId = typeof payload.session_id === "number" ? payload.session_id : null;
    const surfacedAtRaw = payload.surfaced_at;
    let surfacedAt = new Date();
    if (typeof surfacedAtRaw === "string") {
      const parsed = new Date(surfacedAtRaw);
      if (!Number.isNaN(parsed.getTime())) {
        surfacedAt = parsed;
      }
    }

    const db = await getDb();
    let existingQuery = db
      .selectFrom("surfaced_findings")
      .select(["id"])
      .where("finding_id", "=", findingId);
    if (sessionId !== null) {
      existingQuery = existingQuery.where("session_id", "=", sessionId);
    } else {
      existingQuery = existingQuery.where("session_id", "is", null);
    }
    const existing = await existingQuery.executeTakeFirst();
    if (existing) {
      return c.json({ status: "exists" });
    }

    await db
      .insertInto("surfaced_findings")
      .values({
        finding_id: findingId,
        session_id: sessionId,
        surfaced_at: surfacedAt,
      })
      .execute();

    return c.json({ status: "marked" });
  });
}
