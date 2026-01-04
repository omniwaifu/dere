import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { findVaultRoot } from "../scripts/detect_vault.js";

// Shared utilities

function normalizeText(text: string): string {
  return text.toLowerCase().trim();
}

function extractFrontmatterTags(content: string): string[] {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return [];
  }
  const frontmatter = match[1];
  const tags: string[] = [];
  let inTags = false;

  for (const line of frontmatter.split("\n")) {
    if (line.startsWith("tags:")) {
      inTags = true;
      continue;
    }
    if (inTags) {
      if (line.startsWith("  - ")) {
        tags.push(line.replace("  - ", "").trim());
      } else if (!line.startsWith(" ")) {
        break;
      }
    }
  }

  return tags;
}

function extractTitle(content: string): string | null {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (frontmatterMatch) {
    const titleMatch = frontmatterMatch[1].match(/^title:\s*["']?(.+?)["']?\s*$/m);
    if (titleMatch?.[1]) {
      return titleMatch[1];
    }
  }

  const headingMatch = content.match(/^#\s+(.+)$/m);
  if (headingMatch?.[1]) {
    return headingMatch[1];
  }

  return null;
}

function isPermanentNote(content: string): boolean {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return false;
  }
  return match[1].includes("type: permanent");
}

function extractWikiLinks(content: string): Set<string> {
  return new Set([...content.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => match[1]));
}

function calculateSimilarity(
  query: string,
  noteTitle: string,
  noteTags: string[],
  noteContent: string,
): number {
  const queryNorm = normalizeText(query);
  const titleNorm = normalizeText(noteTitle);
  const contentNorm = normalizeText(noteContent);

  let score = 0;

  if (queryNorm === titleNorm) {
    score += 1;
  } else if (titleNorm.includes(queryNorm)) {
    score += 0.7;
  } else if (titleNorm.split(/\s+/).some((word) => word.length > 3 && queryNorm.includes(word))) {
    score += 0.5;
  }

  const queryWords = new Set(queryNorm.split(/\s+/));
  const tagWords = new Set(noteTags.join(" ").toLowerCase().split(/\s+/));
  for (const word of queryWords) {
    if (tagWords.has(word)) {
      score += 0.3;
      break;
    }
  }

  if (contentNorm.includes(queryNorm)) {
    score += 0.2;
  }

  return Math.min(score, 1);
}

// File system walker

async function* walk(dir: string): AsyncGenerator<string> {
  let items;
  try {
    items = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const item of items) {
    const fullPath = join(dir, item.name);
    if (item.isDirectory()) {
      yield* walk(fullPath);
    } else if (item.isFile() && item.name.endsWith(".md")) {
      yield fullPath;
    }
  }
}

// Data types

type NoteData = {
  path: string;
  title: string;
  links_out: Set<string>;
  links_in: Set<string>;
  tags: string[];
};

type ConceptResult = {
  path: string;
  title: string;
  tags: string[];
  similarity: number;
};

// Core analysis functions

async function searchConcepts(
  vaultPath: string,
  query: string,
  threshold: number,
  limit: number,
): Promise<ConceptResult[]> {
  const results: ConceptResult[] = [];

  for await (const notePath of walk(vaultPath)) {
    let content: string;
    try {
      content = await readFile(notePath, "utf-8");
    } catch {
      continue;
    }

    if (!isPermanentNote(content)) {
      continue;
    }

    const title = extractTitle(content);
    if (!title) {
      continue;
    }

    const tags = extractFrontmatterTags(content);
    const similarity = calculateSimilarity(query, title, tags, content);

    if (similarity >= threshold) {
      results.push({
        path: relative(vaultPath, notePath),
        title,
        tags,
        similarity,
      });
    }
  }

  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, limit);
}

async function analyzeVault(vaultPath: string): Promise<Record<string, NoteData>> {
  const notes: Record<string, NoteData> = {};
  const noteTitles: Record<string, string> = {};

  for await (const notePath of walk(vaultPath)) {
    let content: string;
    try {
      content = await readFile(notePath, "utf-8");
    } catch {
      continue;
    }

    if (!isPermanentNote(content)) {
      continue;
    }

    const title = extractTitle(content);
    if (!title) {
      continue;
    }

    const noteKey = notePath.split("/").pop()?.replace(/\.md$/, "") ?? notePath;
    noteTitles[noteKey] = title;
    noteTitles[title] = title;

    const links = extractWikiLinks(content);
    const tags = extractFrontmatterTags(content);

    notes[noteKey] = {
      path: relative(vaultPath, notePath),
      title,
      links_out: links,
      links_in: new Set<string>(),
      tags,
    };
  }

  // Build incoming links
  for (const [noteKey, noteData] of Object.entries(notes)) {
    for (const link of noteData.links_out) {
      let targetKey = link;
      if (noteTitles[link]) {
        for (const [key, data] of Object.entries(notes)) {
          if (data.title === link) {
            targetKey = key;
            break;
          }
        }
      }
      if (notes[targetKey]) {
        notes[targetKey].links_in.add(noteKey);
      }
    }
  }

  return notes;
}

function calculateStatistics(notes: Record<string, NoteData>): Record<string, number> {
  const noteList = Object.values(notes);
  if (!noteList.length) {
    return {
      total_notes: 0,
      avg_total_links: 0,
      avg_out_links: 0,
      avg_in_links: 0,
      max_links: 0,
      min_links: 0,
    };
  }

  const linkCounts = noteList.map((note) => note.links_out.size + note.links_in.size);
  const outCounts = noteList.map((note) => note.links_out.size);
  const inCounts = noteList.map((note) => note.links_in.size);

  return {
    total_notes: noteList.length,
    avg_total_links: linkCounts.reduce((sum, value) => sum + value, 0) / linkCounts.length,
    avg_out_links: outCounts.reduce((sum, value) => sum + value, 0) / outCounts.length,
    avg_in_links: inCounts.reduce((sum, value) => sum + value, 0) / inCounts.length,
    max_links: Math.max(...linkCounts),
    min_links: Math.min(...linkCounts),
  };
}

function findOrphans(
  notes: Record<string, NoteData>,
  minLinks: number,
): Array<{ title: string; path: string; links_out: number; links_in: number; total: number }> {
  const orphans: Array<{
    title: string;
    path: string;
    links_out: number;
    links_in: number;
    total: number;
  }> = [];

  for (const noteData of Object.values(notes)) {
    const totalLinks = noteData.links_out.size + noteData.links_in.size;
    if (totalLinks < minLinks) {
      orphans.push({
        title: noteData.title,
        path: noteData.path,
        links_out: noteData.links_out.size,
        links_in: noteData.links_in.size,
        total: totalLinks,
      });
    }
  }

  orphans.sort((a, b) => a.total - b.total);
  return orphans;
}

function suggestConnections(
  notes: Record<string, NoteData>,
  noteTitle: string,
  limit: number,
): Array<{ title: string; path: string; shared_tags: string[] }> {
  // Find note by title
  let targetNote: NoteData | null = null;
  let targetKey: string | null = null;

  for (const [key, data] of Object.entries(notes)) {
    if (key === noteTitle || data.title === noteTitle) {
      targetNote = data;
      targetKey = key;
      break;
    }
  }

  if (!targetNote || !targetKey) {
    return [];
  }

  const targetTags = new Set(targetNote.tags);
  if (targetTags.size === 0) {
    return [];
  }

  const suggestions: Array<{ title: string; path: string; shared_tags: string[]; count: number }> =
    [];

  for (const [otherKey, otherNote] of Object.entries(notes)) {
    if (otherKey === targetKey) {
      continue;
    }
    // Skip if already linked
    if (targetNote.links_out.has(otherKey) || targetNote.links_in.has(otherKey)) {
      continue;
    }
    if (targetNote.links_out.has(otherNote.title) || targetNote.links_in.has(otherNote.title)) {
      continue;
    }

    const otherTags = new Set(otherNote.tags);
    const overlap = [...targetTags].filter((tag) => otherTags.has(tag));

    if (overlap.length > 0) {
      suggestions.push({
        title: otherNote.title,
        path: otherNote.path,
        shared_tags: overlap,
        count: overlap.length,
      });
    }
  }

  suggestions.sort((a, b) => b.count - a.count);
  return suggestions.slice(0, limit).map(({ title, path, shared_tags }) => ({
    title,
    path,
    shared_tags,
  }));
}

// MCP Server

const server = new McpServer({
  name: "Vault Knowledge Graph",
  version: "1.0.0",
});

function getVaultPath(providedPath?: string): string {
  const vaultPath = providedPath ?? findVaultRoot();
  if (!vaultPath) {
    throw new Error("Could not find vault. Provide vault_path or run from within a vault.");
  }
  return vaultPath;
}

// Tool: search_vault_concepts

const SearchConceptsSchema = z.object({
  query: z.string().describe("Search query to find related concepts"),
  threshold: z.number().optional().default(0.3).describe("Minimum similarity score (0-1)"),
  limit: z.number().optional().default(10).describe("Maximum results to return"),
  vault_path: z.string().optional().describe("Path to vault (auto-detected if not provided)"),
});

server.registerTool(
  "search_vault_concepts",
  {
    description:
      "Search for permanent notes (concepts) in the vault by similarity to query. Matches against title, tags, and content.",
    inputSchema: SearchConceptsSchema.shape,
  },
  async (args) => {
    const parsed = SearchConceptsSchema.parse(args);
    const vaultPath = getVaultPath(parsed.vault_path);
    const results = await searchConcepts(vaultPath, parsed.query, parsed.threshold, parsed.limit);

    if (results.length === 0) {
      return {
        content: [{ type: "text", text: JSON.stringify({ results: [], message: "No matching concepts found" }) }],
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify({ results }) }],
    };
  },
);

// Tool: get_vault_stats

const StatsSchema = z.object({
  vault_path: z.string().optional().describe("Path to vault (auto-detected if not provided)"),
});

server.registerTool(
  "get_vault_stats",
  {
    description:
      "Get statistics about the vault's permanent notes: total count, average links, and link distribution.",
    inputSchema: StatsSchema.shape,
  },
  async (args) => {
    const parsed = StatsSchema.parse(args);
    const vaultPath = getVaultPath(parsed.vault_path);
    const notes = await analyzeVault(vaultPath);
    const stats = calculateStatistics(notes);

    return {
      content: [{ type: "text", text: JSON.stringify(stats) }],
    };
  },
);

// Tool: find_vault_orphans

const OrphansSchema = z.object({
  min_links: z
    .number()
    .optional()
    .default(3)
    .describe("Notes with fewer than this many links are considered orphans"),
  limit: z.number().optional().default(20).describe("Maximum orphans to return"),
  vault_path: z.string().optional().describe("Path to vault (auto-detected if not provided)"),
});

server.registerTool(
  "find_vault_orphans",
  {
    description:
      "Find orphaned notes that have fewer than the minimum number of links (both incoming and outgoing).",
    inputSchema: OrphansSchema.shape,
  },
  async (args) => {
    const parsed = OrphansSchema.parse(args);
    const vaultPath = getVaultPath(parsed.vault_path);
    const notes = await analyzeVault(vaultPath);
    const orphans = findOrphans(notes, parsed.min_links).slice(0, parsed.limit);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            min_links_threshold: parsed.min_links,
            orphan_count: orphans.length,
            orphans,
          }),
        },
      ],
    };
  },
);

// Tool: suggest_vault_connections

const SuggestSchema = z.object({
  note_title: z.string().describe("Title of the note to find suggestions for"),
  limit: z.number().optional().default(5).describe("Maximum suggestions to return"),
  vault_path: z.string().optional().describe("Path to vault (auto-detected if not provided)"),
});

server.registerTool(
  "suggest_vault_connections",
  {
    description:
      "Suggest potential connections for a note based on shared tags with other notes that aren't already linked.",
    inputSchema: SuggestSchema.shape,
  },
  async (args) => {
    const parsed = SuggestSchema.parse(args);
    const vaultPath = getVaultPath(parsed.vault_path);
    const notes = await analyzeVault(vaultPath);
    const suggestions = suggestConnections(notes, parsed.note_title, parsed.limit);

    if (suggestions.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              note_title: parsed.note_title,
              suggestions: [],
              message: "No suggestions found (note may already be well-connected or have no shared tags)",
            }),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            note_title: parsed.note_title,
            suggestions,
          }),
        },
      ],
    };
  },
);

// Main

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Vault Knowledge Graph Server running on stdio");
}

main().catch((error) => {
  console.error("Server crashed:", error);
  process.exit(1);
});
