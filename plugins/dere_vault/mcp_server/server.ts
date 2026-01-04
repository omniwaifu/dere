import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { VaultIntegration, ZoteroClient, buildCollectionHierarchy, loadConfig } from "./zotero.js";

const server = new McpServer({
  name: "Zotero Library Manager",
  version: "1.0.0",
});

function extractVideoId(urlOrId: string): string {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const pattern of patterns) {
    const match = urlOrId.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  throw new Error(`Could not extract video ID from: ${urlOrId}`);
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function fetchYoutubeTranscript(videoId: string): Promise<string> {
  const url = new URL("https://www.youtube.com/api/timedtext");
  url.searchParams.set("lang", "en");
  url.searchParams.set("v", videoId);
  url.searchParams.set("fmt", "json3");

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Failed to fetch transcript (${response.status})`);
  }

  const raw = await response.text();
  try {
    const data = JSON.parse(raw) as { events?: Array<{ segs?: Array<{ utf8?: string }> }> };
    const parts: string[] = [];
    for (const event of data.events ?? []) {
      for (const seg of event.segs ?? []) {
        if (seg.utf8) {
          parts.push(seg.utf8);
        }
      }
    }
    return parts.join(" ").replace(/\s+/g, " ").trim();
  } catch {
    const matches = [...raw.matchAll(/<text[^>]*>(.*?)<\/text>/g)];
    const parts = matches.map((match) => decodeHtmlEntities(match[1] ?? ""));
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }
}

const SearchZoteroSchema = z.object({
  query: z.string(),
  search_type: z.string().optional().default("title"),
});

server.registerTool(
  "search_zotero",
  {
    description: "Search Zotero library by title, author, url, or citekey.",
    inputSchema: SearchZoteroSchema.shape,
  },
  async (args) => {
    const parsed = SearchZoteroSchema.parse(args);
    const config = loadConfig();
    const client = new ZoteroClient(config);
    const items = await client.searchItems(parsed.query, parsed.search_type);
    const result = items.map((item) => ({
      key: item.key,
      title: item.title,
      authors: item.formatAuthors(),
      year: item.year,
      url: item.url,
      item_type: item.item_type,
    }));
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
);

const AddZoteroItemSchema = z.object({
  title: z.string(),
  url: z.string().optional(),
  author: z.string().optional(),
  item_type: z.string().optional().default("webpage"),
  abstract: z.string().optional(),
  date: z.string().optional(),
});

server.registerTool(
  "add_zotero_item",
  {
    description: "Add new item to Zotero library.",
    inputSchema: AddZoteroItemSchema.shape,
  },
  async (args) => {
    const parsed = AddZoteroItemSchema.parse(args);
    const config = loadConfig();
    const client = new ZoteroClient(config);
    const itemKey = await client.addItem(
      parsed.title,
      parsed.url,
      parsed.author,
      parsed.item_type,
      parsed.abstract,
      parsed.date,
    );
    const item = await client.getItem(itemKey);
    if (!item) {
      throw new Error(`Item not found after creation: ${itemKey}`);
    }
    const result = {
      key: item.key,
      title: item.title,
      authors: item.formatAuthors(),
      url: item.url,
      message: `Successfully created item in Zotero (key: ${itemKey})`,
    };
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
);

const CreateLiteratureNoteSchema = z.object({
  item_key: z.string(),
  vault_path: z.string().optional(),
  use_citekey_naming: z.boolean().optional().default(true),
});

server.registerTool(
  "create_literature_note",
  {
    description: "Create Obsidian literature note from Zotero item.",
    inputSchema: CreateLiteratureNoteSchema.shape,
  },
  async (args) => {
    const parsed = CreateLiteratureNoteSchema.parse(args);
    const config = loadConfig();
    const client = new ZoteroClient(config);

    let item = await client.getItem(parsed.item_key);
    if (!item) {
      throw new Error(`Item not found: ${parsed.item_key}`);
    }

    if (!item.citekey) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      item = await client.getItem(parsed.item_key);
      if (!item) {
        throw new Error(`Item not found after refetch: ${parsed.item_key}`);
      }
    }

    const collectionPaths = await client.getItemCollections(parsed.item_key);
    const vault = new VaultIntegration(parsed.vault_path ?? null);
    const notePath = await vault.createLiteratureNote(
      item,
      parsed.use_citekey_naming,
      collectionPaths,
    );

    const result = {
      note_path: notePath,
      title: item.title,
      message: `Created literature note: ${notePath.split("/").pop()}`,
    };

    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
);

server.registerTool(
  "list_collections",
  {
    description: "List all Zotero collections with hierarchy paths.",
    inputSchema: z.object({}).shape,
  },
  async () => {
    const config = loadConfig();
    const client = new ZoteroClient(config);
    const result = await client.getCollections();
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
);

const CreateCollectionSchema = z.object({
  collection_path: z.string(),
});

server.registerTool(
  "create_collection_hierarchy",
  {
    description: "Create collection hierarchy, building parents as needed.",
    inputSchema: CreateCollectionSchema.shape,
  },
  async (args) => {
    const parsed = CreateCollectionSchema.parse(args);
    const config = loadConfig();
    const client = new ZoteroClient(config);
    const collectionKey = await buildCollectionHierarchy(client, parsed.collection_path);
    const collections = await client.getCollections();
    const collInfo = collections[collectionKey] ?? {};
    const result = {
      collection_key: collectionKey,
      path: collInfo.path ?? parsed.collection_path,
      message: `Created collection hierarchy: ${parsed.collection_path}`,
    };
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
);

const AddItemToCollectionSchema = z.object({
  item_key: z.string(),
  collection_path: z.string(),
});

server.registerTool(
  "add_item_to_collection",
  {
    description: "Add item to collection (creates hierarchy if needed).",
    inputSchema: AddItemToCollectionSchema.shape,
  },
  async (args) => {
    const parsed = AddItemToCollectionSchema.parse(args);
    const config = loadConfig();
    const client = new ZoteroClient(config);
    const collectionKey = await buildCollectionHierarchy(client, parsed.collection_path);
    await client.addToCollection(parsed.item_key, collectionKey);
    const result = {
      item_key: parsed.item_key,
      collection_path: parsed.collection_path,
      message: `Added item to collection: ${parsed.collection_path}`,
    };
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
);

server.registerTool(
  "list_all_tags",
  {
    description: "List all existing tags in library.",
    inputSchema: z.object({}).shape,
  },
  async () => {
    const config = loadConfig();
    const client = new ZoteroClient(config);
    const result = await client.getAllTags();
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
);

const TagsSchema = z.object({
  item_key: z.string(),
  tags: z.array(z.string()),
});

server.registerTool(
  "add_tags_to_item",
  {
    description: "Add tags to item (preserves existing tags).",
    inputSchema: TagsSchema.shape,
  },
  async (args) => {
    const parsed = TagsSchema.parse(args);
    const config = loadConfig();
    const client = new ZoteroClient(config);
    await client.addTags(parsed.item_key, parsed.tags);
    const result = {
      item_key: parsed.item_key,
      tags_added: parsed.tags,
      message: `Added ${parsed.tags.length} tags to item`,
    };
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
);

server.registerTool(
  "set_item_tags",
  {
    description: "Replace all tags on item.",
    inputSchema: TagsSchema.shape,
  },
  async (args) => {
    const parsed = TagsSchema.parse(args);
    const config = loadConfig();
    const client = new ZoteroClient(config);
    await client.updateTags(parsed.item_key, parsed.tags);
    const result = {
      item_key: parsed.item_key,
      tags: parsed.tags,
      message: `Set ${parsed.tags.length} tags on item`,
    };
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
);

server.registerTool(
  "list_unfiled_items",
  {
    description: "List items not in any collection.",
    inputSchema: z.object({}).shape,
  },
  async () => {
    const config = loadConfig();
    const client = new ZoteroClient(config);
    const items = await client.listUnfiledItems();
    const result = items.map((item) => ({
      key: item.key,
      title: item.title,
      authors: item.formatAuthors(),
      year: item.year,
      abstract: item.abstract,
      url: item.url,
      tags: item.tags,
      item_type: item.item_type,
    }));
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
);

const TranscriptSchema = z.object({
  url_or_video_id: z.string(),
});

server.registerTool(
  "get_youtube_transcript",
  {
    description: "Get transcript from a YouTube video.",
    inputSchema: TranscriptSchema.shape,
  },
  async (args) => {
    const parsed = TranscriptSchema.parse(args);
    const videoId = extractVideoId(parsed.url_or_video_id);
    const transcript = await fetchYoutubeTranscript(videoId);
    const result = { video_id: videoId, transcript };
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Zotero Server running on stdio");
}

main().catch((error) => {
  console.error("Server crashed:", error);
  process.exit(1);
});
