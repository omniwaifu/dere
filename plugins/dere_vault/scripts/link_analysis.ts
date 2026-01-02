import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { findVaultRoot } from "./detect_vault.js";

function extractWikiLinks(content: string): Set<string> {
  return new Set([...content.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => match[1]));
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

type NoteData = {
  path: string;
  title: string;
  links_out: Set<string>;
  links_in: Set<string>;
  tags: string[];
};

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

function findOrphans(
  notes: Record<string, NoteData>,
  minLinks: number,
): Array<Record<string, unknown>> {
  const orphans: Array<Record<string, unknown>> = [];
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
  orphans.sort((a, b) => (a.total as number) - (b.total as number));
  return orphans;
}

function suggestConnections(
  notes: Record<string, NoteData>,
  noteKey: string,
  limit: number,
): Array<Record<string, unknown>> {
  const targetNote = notes[noteKey];
  if (!targetNote) {
    return [];
  }

  const targetTags = new Set(targetNote.tags);
  if (targetTags.size === 0) {
    return [];
  }

  const suggestions: Array<Record<string, unknown>> = [];
  for (const [otherKey, otherNote] of Object.entries(notes)) {
    if (otherKey === noteKey) {
      continue;
    }
    if (targetNote.links_out.has(otherKey) || targetNote.links_in.has(otherKey)) {
      continue;
    }
    const otherTags = new Set(otherNote.tags);
    const overlap = [...targetTags].filter((tag) => otherTags.has(tag));
    if (overlap.length) {
      suggestions.push({
        title: otherNote.title,
        path: otherNote.path,
        shared_tags: overlap,
        overlap_count: overlap.length,
      });
    }
  }

  suggestions.sort((a, b) => (b.overlap_count as number) - (a.overlap_count as number));
  return suggestions.slice(0, limit);
}

function calculateStatistics(notes: Record<string, NoteData>): Record<string, number> {
  const noteList = Object.values(notes);
  if (!noteList.length) {
    return {};
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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let vaultPath: string | null = null;
  let showOrphans = false;
  let suggestTitle: string | null = null;
  let showStats = false;
  let minLinks = 3;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--vault-path") {
      vaultPath = args[i + 1] ?? null;
      i += 1;
    } else if (arg === "--orphans") {
      showOrphans = true;
    } else if (arg === "--suggest") {
      suggestTitle = args[i + 1] ?? null;
      i += 1;
    } else if (arg === "--stats") {
      showStats = true;
    } else if (arg === "--min-links") {
      minLinks = Number.parseInt(args[i + 1] ?? "3", 10);
      i += 1;
    }
  }

  const resolvedVault = vaultPath ?? findVaultRoot();
  if (!resolvedVault) {
    console.error("Error: Could not find vault. Specify --vault-path");
    process.exit(1);
  }

  console.log("Analyzing vault knowledge graph...\n");
  const notes = await analyzeVault(resolvedVault);

  if (!Object.keys(notes).length) {
    console.log("No permanent notes found in vault");
    process.exit(0);
  }

  if (showStats || (!showOrphans && !suggestTitle)) {
    const stats = calculateStatistics(notes);
    console.log("Vault Statistics:");
    console.log(`  Total permanent notes: ${stats.total_notes}`);
    console.log(`  Average total links: ${stats.avg_total_links.toFixed(1)}`);
    console.log(`  Average outgoing links: ${stats.avg_out_links.toFixed(1)}`);
    console.log(`  Average incoming links: ${stats.avg_in_links.toFixed(1)}`);
    console.log(`  Max links (any note): ${stats.max_links}`);
    console.log(`  Min links (any note): ${stats.min_links}`);
    console.log("");
  }

  if (showOrphans) {
    const orphans = findOrphans(notes, minLinks);
    if (orphans.length) {
      console.log(`Found ${orphans.length} orphaned note(s) with < ${minLinks} total links:\n`);
      orphans.forEach((orphan, index) => {
        console.log(`${index + 1}. ${orphan.title}`);
        console.log(`   Path: ${orphan.path}`);
        console.log(
          `   Links: ${orphan.links_out} out, ${orphan.links_in} in (${orphan.total} total)`,
        );
        console.log("");
      });
    } else {
      console.log(`No orphaned notes found (all notes have >= ${minLinks} links)`);
    }
  }

  if (suggestTitle) {
    let noteKey: string | null = null;
    for (const [key, noteData] of Object.entries(notes)) {
      if (key === suggestTitle || noteData.title === suggestTitle) {
        noteKey = key;
        break;
      }
    }

    if (!noteKey) {
      console.error(`Error: Note not found: ${suggestTitle}`);
      process.exit(1);
    }

    const suggestions = suggestConnections(notes, noteKey, 5);
    if (suggestions.length) {
      console.log(`Suggested connections for: ${notes[noteKey].title}\n`);
      suggestions.forEach((suggestion, index) => {
        console.log(`${index + 1}. ${suggestion.title}`);
        console.log(`   Path: ${suggestion.path}`);
        console.log(`   Shared tags: ${(suggestion.shared_tags as string[]).join(", ")}`);
        console.log("");
      });
    } else {
      console.log(`No suggestions found for: ${notes[noteKey].title}`);
      console.log("(Note may already be well-connected or have no shared tags with other notes)");
    }
  }
}

if (import.meta.main) {
  void main();
}
