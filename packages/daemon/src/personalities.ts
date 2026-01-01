import { parse } from "@iarna/toml";
import { readdir, readFile } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { getConfigPath } from "@dere/shared-config";

export interface Personality {
  name: string;
  short_name: string;
  aliases: string[];
  color: string;
  icon: string;
  avatar?: string;
  prompt_content: string;
  announcement?: string;
  occ_goals: unknown[];
  occ_standards: unknown[];
  occ_attitudes: unknown[];
}

export interface PersonalityInfo {
  name: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
}

interface PersonalityDoc {
  metadata?: {
    name?: string;
    short_name?: string;
    aliases?: string[];
  };
  display?: {
    color?: string;
    icon?: string;
    avatar?: string;
    announcement?: string;
  };
  prompt?: {
    content?: string;
  };
  occ?: {
    goals?: unknown[];
    standards?: unknown[];
    attitudes?: unknown[];
  };
}

function defaultEmbeddedDir(): string {
  const envDir = process.env.DERE_EMBEDDED_PERSONALITIES_DIR;
  if (envDir) {
    return envDir;
  }
  return join(process.cwd(), "src", "dere_shared", "personalities");
}

function defaultUserDir(): string {
  const configPath = getConfigPath();
  return join(dirname(configPath), "personalities");
}

function parsePersonality(data: string): Personality {
  const parsed = parse(data) as PersonalityDoc;
  const metadata = parsed.metadata ?? {};
  const display = parsed.display ?? {};
  const prompt = parsed.prompt ?? {};
  const occ = parsed.occ ?? {};

  return {
    name: metadata.name ?? "",
    short_name: metadata.short_name ?? "",
    aliases: metadata.aliases ?? [],
    color: display.color ?? "white",
    icon: display.icon ?? "*",
    avatar: display.avatar,
    prompt_content: prompt.content ?? "",
    announcement: display.announcement,
    occ_goals: occ.goals ?? [],
    occ_standards: occ.standards ?? [],
    occ_attitudes: occ.attitudes ?? [],
  };
}

async function loadPersonalityFromFile(path: string): Promise<Personality> {
  const text = await readFile(path, "utf-8");
  return parsePersonality(text);
}

async function listTomlNames(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".toml"))
      .map((entry) => basename(entry.name, ".toml"));
  } catch {
    return [];
  }
}

export async function listPersonalityInfos(): Promise<PersonalityInfo[]> {
  const embeddedDir = defaultEmbeddedDir();
  const userDir = defaultUserDir();

  const [embeddedNames, userNames] = await Promise.all([
    listTomlNames(embeddedDir),
    listTomlNames(userDir),
  ]);

  const uniqueNames = Array.from(new Set([...embeddedNames, ...userNames])).sort();
  const results: PersonalityInfo[] = [];

  for (const name of uniqueNames) {
    try {
      let personality: Personality | null = null;
      const userPath = join(userDir, `${name}.toml`);
      try {
        personality = await loadPersonalityFromFile(userPath);
      } catch {
        const embeddedPath = join(embeddedDir, `${name}.toml`);
        personality = await loadPersonalityFromFile(embeddedPath);
      }

      const description = personality.prompt_content;
      results.push({
        name,
        description: description.length > 100 ? `${description.slice(0, 100)}...` : description,
        color: personality.color,
        icon: personality.icon,
      });
    } catch {
      results.push({ name });
    }
  }

  return results;
}

export async function loadPersonality(name: string): Promise<Personality> {
  const embeddedDir = defaultEmbeddedDir();
  const userDir = defaultUserDir();
  const userPath = join(userDir, `${name}.toml`);
  try {
    return await loadPersonalityFromFile(userPath);
  } catch {
    const embeddedPath = join(embeddedDir, `${name}.toml`);
    return await loadPersonalityFromFile(embeddedPath);
  }
}
