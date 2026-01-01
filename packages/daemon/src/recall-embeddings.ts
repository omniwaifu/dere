import { sql } from "kysely";

import { getDb } from "./db.js";
import { OpenAIEmbedder } from "@dere/graph";

const RECALL_EMBEDDING_CHECK_INTERVAL_MS = 120_000;
const RECALL_EMBEDDING_BATCH_SIZE = 50;

let recallEmbeddingTimer: ReturnType<typeof setInterval> | null = null;
let recallEmbeddingRunning = false;
let recallEmbedderPromise: Promise<OpenAIEmbedder | null> | null = null;
let lastEmbedderError: string | null = null;

export function vectorLiteral(embedding: number[]): string {
  return `[${embedding.map((value) => value.toFixed(6)).join(",")}]`;
}

export async function getRecallEmbedder(): Promise<OpenAIEmbedder | null> {
  if (recallEmbedderPromise) {
    const cached = await recallEmbedderPromise;
    if (cached) {
      return cached;
    }
  }

  recallEmbedderPromise = (async () => {
    try {
      return await OpenAIEmbedder.fromConfig();
    } catch (error) {
      const message = String(error);
      if (message !== lastEmbedderError) {
        console.log(`[recall] embedder unavailable: ${message}`);
        lastEmbedderError = message;
      }
      return null;
    }
  })();

  const resolved = await recallEmbedderPromise;
  if (!resolved) {
    recallEmbedderPromise = null;
  }
  return resolved;
}

async function backfillConversationBlocks(): Promise<void> {
  if (recallEmbeddingRunning) {
    return;
  }
  recallEmbeddingRunning = true;

  try {
    const embedder = await getRecallEmbedder();
    if (!embedder) {
      return;
    }

    const db = await getDb();
    const now = new Date();

    const missingConversations = await db
      .selectFrom("conversations as c")
      .leftJoin("conversation_blocks as cb", "cb.conversation_id", "c.id")
      .select(["c.id as conversation_id", "c.prompt as prompt"])
      .where("cb.id", "is", null)
      .where("c.prompt", "is not", null)
      .where(sql`c.prompt <> ''`)
      .limit(RECALL_EMBEDDING_BATCH_SIZE)
      .execute();

    if (missingConversations.length > 0) {
      await db
        .insertInto("conversation_blocks")
        .values(
          missingConversations.map((row) => ({
            conversation_id: row.conversation_id as number,
            ordinal: 0,
            block_type: "text",
            text: String(row.prompt ?? ""),
            tool_use_id: null,
            tool_name: null,
            tool_input: null,
            is_error: null,
            content_embedding: null,
            created_at: now,
          })),
        )
        .execute();
    }

    const blocks = await db
      .selectFrom("conversation_blocks as cb")
      .innerJoin("conversations as c", "c.id", "cb.conversation_id")
      .select(["cb.id as block_id", "cb.text as text"])
      .where("cb.content_embedding", "is", null)
      .where("cb.block_type", "=", "text")
      .where("cb.text", "is not", null)
      .where(sql`cb.text <> ''`)
      .limit(RECALL_EMBEDDING_BATCH_SIZE)
      .execute();

    if (blocks.length === 0) {
      return;
    }

    const texts = blocks.map((block) => String(block.text ?? "").replace(/\n/g, " "));
    const embeddings = await embedder.createBatch(texts);

    for (let i = 0; i < blocks.length; i += 1) {
      const embedding = embeddings[i];
      if (!embedding || embedding.length === 0) {
        continue;
      }
      const vector = vectorLiteral(embedding);
      await db
        .updateTable("conversation_blocks")
        .set({ content_embedding: sql`${vector}::vector` })
        .where("id", "=", blocks[i].block_id as number)
        .execute();
    }
  } catch (error) {
    console.log(`[recall] embedding backfill failed: ${String(error)}`);
  } finally {
    recallEmbeddingRunning = false;
  }
}

export function startRecallEmbeddingLoop(): void {
  if (recallEmbeddingTimer) {
    return;
  }
  recallEmbeddingTimer = setInterval(() => {
    void backfillConversationBlocks();
  }, RECALL_EMBEDDING_CHECK_INTERVAL_MS);

  console.log(
    `[recall] embedding backfill loop started (${RECALL_EMBEDDING_CHECK_INTERVAL_MS}ms interval)`,
  );
}

export function stopRecallEmbeddingLoop(): void {
  if (!recallEmbeddingTimer) {
    return;
  }
  clearInterval(recallEmbeddingTimer);
  recallEmbeddingTimer = null;
  console.log("[recall] embedding backfill loop stopped");
}
