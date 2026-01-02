import { readFile } from "node:fs/promises";
import { relative } from "node:path";

import { findVaultRoot } from "./detect_vault.js";

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

async function* walk(dir: string): AsyncGenerator<string> {
  const { readdir } = await import("node:fs/promises");
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

type ConceptResult = {
  path: string;
  title: string;
  tags: string[];
  similarity: number;
};

async function searchConcepts(
  vaultPath: string,
  query: string,
  threshold: number,
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
  return results;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(
      "Usage: concept_search.ts <query> [--threshold 0.3] [--vault-path path] [--limit 10]",
    );
    process.exit(1);
  }

  const query = args[0];
  let threshold = 0.3;
  let vaultPath: string | null = null;
  let limit = 10;

  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--threshold") {
      threshold = Number.parseFloat(args[i + 1] ?? "0.3");
      i += 1;
    } else if (arg === "--vault-path") {
      vaultPath = args[i + 1] ?? null;
      i += 1;
    } else if (arg === "--limit") {
      limit = Number.parseInt(args[i + 1] ?? "10", 10);
      i += 1;
    }
  }

  const resolvedVaultPath = vaultPath ?? findVaultRoot();
  if (!resolvedVaultPath) {
    console.error("Error: Could not find vault. Specify --vault-path");
    process.exit(1);
  }

  const results = await searchConcepts(resolvedVaultPath, query, threshold);
  if (results.length === 0) {
    console.log(`No similar concepts found for: ${query}`);
    process.exit(0);
  }

  console.log(`Found ${results.length} similar concept(s) for: ${query}\n`);
  const slice = results.slice(0, limit);
  slice.forEach((result, index) => {
    console.log(`${index + 1}. ${result.title} (similarity: ${result.similarity.toFixed(2)})`);
    console.log(`   Path: ${result.path}`);
    if (result.tags.length) {
      console.log(`   Tags: ${result.tags.join(", ")}`);
    }
    console.log("");
  });
}

if (import.meta.main) {
  void main();
}
