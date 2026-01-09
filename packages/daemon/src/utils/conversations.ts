/**
 * Shared conversation insertion utilities.
 *
 * Consolidates the 10+ separate conversation insertion implementations:
 * - trpc/procedures/sessions.ts
 * - temporal/activities/swarm/database.ts
 * - missions/executor.ts
 * - sessions/conversations.ts
 * - sessions/index.ts
 * - agents/ws.ts
 * - memory/consolidation.ts
 */

import type { Transaction } from "kysely";
import type { DB } from "../db.js";
import { getDb } from "../db.js";

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function nowDate(): Date {
  return new Date();
}

/** Block structure for assistant messages */
export interface ConversationBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  output?: string;
  is_error?: boolean;
}

/** Metrics for assistant responses */
export interface ConversationMetrics {
  ttftMs?: number | null;
  responseMs?: number | null;
  thinkingMs?: number | null;
}

/** Options for inserting a conversation */
export interface InsertConversationOptions {
  sessionId: number;
  messageType: string;
  prompt: string;
  personality: string | null;
  userId?: string | null;
  medium?: string | null;
  metrics?: ConversationMetrics;
  toolUses?: number | null;
  toolNames?: string[] | null;
  /** If true, updates session.last_activity (default: true) */
  updateLastActivity?: boolean;
  /** Optional transaction context - if not provided, uses getDb() */
  trx?: Transaction<DB>;
}

/**
 * Insert a conversation record.
 *
 * For simple user/system messages, this is all you need.
 * For assistant messages with blocks, use insertAssistantWithBlocks instead.
 *
 * @returns The conversation ID
 */
export async function insertConversation(
  options: InsertConversationOptions,
): Promise<number> {
  const {
    sessionId,
    messageType,
    prompt,
    personality,
    userId = null,
    medium = "agent_api",
    metrics = {},
    toolUses = null,
    toolNames = null,
    updateLastActivity = true,
    trx,
  } = options;

  const db = trx ?? (await getDb());
  const now = nowDate();
  const timestamp = nowSeconds();

  const conversation = await db
    .insertInto("conversations")
    .values({
      session_id: sessionId,
      prompt,
      message_type: messageType,
      personality,
      timestamp,
      medium,
      user_id: userId,
      ttft_ms: metrics.ttftMs ?? null,
      response_ms: metrics.responseMs ?? null,
      thinking_ms: metrics.thinkingMs ?? null,
      tool_uses: toolUses,
      tool_names: toolNames,
      created_at: now,
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();

  // Insert a text block if there's content
  if (prompt.trim()) {
    await db
      .insertInto("conversation_blocks")
      .values({
        conversation_id: conversation.id,
        ordinal: 0,
        block_type: "text",
        text: prompt,
        tool_use_id: null,
        tool_name: null,
        tool_input: null,
        is_error: null,
        content_embedding: null,
        created_at: now,
      })
      .execute();
  }

  if (updateLastActivity) {
    await db
      .updateTable("sessions")
      .set({ last_activity: now })
      .where("id", "=", sessionId)
      .execute();
  }

  return conversation.id;
}

/** Options for inserting an assistant message with blocks */
export interface InsertAssistantBlocksOptions {
  sessionId: number;
  blocks: ConversationBlock[];
  personality: string | null;
  userId?: string | null;
  medium?: string | null;
  metrics?: ConversationMetrics;
  /** If true, updates session.last_activity (default: true) */
  updateLastActivity?: boolean;
  /** Optional transaction context - if not provided, uses getDb() */
  trx?: Transaction<DB>;
}

/**
 * Insert an assistant message with blocks (text, thinking, tool_use, tool_result).
 *
 * Extracts text content for the prompt field and stores individual blocks.
 * Returns null if blocks array is empty.
 *
 * @returns The conversation ID, or null if no blocks
 */
export async function insertAssistantWithBlocks(
  options: InsertAssistantBlocksOptions,
): Promise<number | null> {
  const {
    blocks,
    sessionId,
    personality,
    userId = null,
    medium = "agent_api",
    metrics = {},
    updateLastActivity = true,
    trx,
  } = options;

  if (blocks.length === 0) {
    return null;
  }

  const db = trx ?? (await getDb());
  const now = nowDate();
  const timestamp = nowSeconds();

  // Extract text content and count tools
  const textContent = blocks
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");

  const toolNames: string[] = [];
  let toolCount = 0;
  for (const block of blocks) {
    if (block.type === "tool_use" && block.name) {
      toolNames.push(block.name);
      toolCount += 1;
    }
  }

  const conversation = await db
    .insertInto("conversations")
    .values({
      session_id: sessionId,
      prompt: textContent,
      message_type: "assistant",
      personality,
      timestamp,
      medium,
      user_id: userId,
      ttft_ms: metrics.ttftMs ?? null,
      response_ms: metrics.responseMs ?? null,
      thinking_ms: metrics.thinkingMs ?? null,
      tool_uses: toolCount > 0 ? toolCount : null,
      tool_names: toolNames.length > 0 ? toolNames : null,
      created_at: now,
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();

  // Insert blocks
  let ordinal = 0;
  for (const block of blocks) {
    if (block.type === "text" || block.type === "thinking") {
      const text = block.text ?? "";
      if (!text) {
        continue;
      }
      await db
        .insertInto("conversation_blocks")
        .values({
          conversation_id: conversation.id,
          ordinal,
          block_type: block.type,
          text,
          tool_use_id: null,
          tool_name: null,
          tool_input: null,
          is_error: null,
          content_embedding: null,
          created_at: now,
        })
        .execute();
      ordinal += 1;
      continue;
    }

    if (block.type === "tool_use") {
      await db
        .insertInto("conversation_blocks")
        .values({
          conversation_id: conversation.id,
          ordinal,
          block_type: "tool_use",
          tool_use_id: block.id ?? null,
          tool_name: block.name ?? null,
          tool_input: block.input ?? null,
          text: null,
          is_error: null,
          content_embedding: null,
          created_at: now,
        })
        .execute();
      ordinal += 1;
      continue;
    }

    if (block.type === "tool_result") {
      const output = block.output ?? "";
      await db
        .insertInto("conversation_blocks")
        .values({
          conversation_id: conversation.id,
          ordinal,
          block_type: "tool_result",
          tool_use_id: block.tool_use_id ?? null,
          text: output,
          is_error: block.is_error ?? null,
          tool_name: null,
          tool_input: null,
          content_embedding: null,
          created_at: now,
        })
        .execute();
      ordinal += 1;
      continue;
    }
  }

  if (updateLastActivity) {
    await db
      .updateTable("sessions")
      .set({ last_activity: now })
      .where("id", "=", sessionId)
      .execute();
  }

  return conversation.id;
}
