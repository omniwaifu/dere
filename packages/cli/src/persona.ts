import { parse } from "@iarna/toml";
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { getConfigPath } from "@dere/shared-config";

type PersonalityDoc = {
  metadata?: {
    name?: string;
    short_name?: string;
    aliases?: string[];
  };
  display?: {
    color?: string;
    icon?: string;
    announcement?: string;
  };
  prompt?: {
    content?: string;
  };
};

export type Personality = {
  name: string;
  short_name: string;
  aliases: string[];
  color: string;
  icon: string;
  prompt_content: string;
  announcement?: string;
};

function defaultEmbeddedDir(): string {
  const envDir = process.env.DERE_EMBEDDED_PERSONALITIES_DIR;
  if (envDir) {
    return envDir;
  }
  return join(process.cwd(), "src", "dere_shared", "personalities");
}

function defaultUserDir(): string {
  return join(dirname(getConfigPath()), "personalities");
}

function parsePersonality(data: string): Personality {
  const parsed = parse(data) as PersonalityDoc;
  const metadata = parsed.metadata ?? {};
  const display = parsed.display ?? {};
  const prompt = parsed.prompt ?? {};

  return {
    name: metadata.name ?? "",
    short_name: metadata.short_name ?? "",
    aliases: metadata.aliases ?? [],
    color: display.color ?? "white",
    icon: display.icon ?? "*",
    prompt_content: prompt.content ?? "",
    announcement: display.announcement,
  };
}

async function loadPersonalityFromFile(path: string): Promise<Personality> {
  const text = await readFile(path, "utf-8");
  return parsePersonality(text);
}

export class PersonalityLoader {
  private readonly userDir: string;
  private readonly embeddedDir: string;

  constructor() {
    this.userDir = defaultUserDir();
    this.embeddedDir = defaultEmbeddedDir();
  }

  async load(name: string): Promise<Personality> {
    const userPath = join(this.userDir, `${name}.toml`);
    try {
      return await loadPersonalityFromFile(userPath);
    } catch {
      const embeddedPath = join(this.embeddedDir, `${name}.toml`);
      return await loadPersonalityFromFile(embeddedPath);
    }
  }

  static normalizeName(name: string): string {
    return basename(name, ".toml");
  }
}
