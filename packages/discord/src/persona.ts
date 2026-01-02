import { parse } from "@iarna/toml";
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { getConfigPath } from "@dere/shared-config";

export type PersonaProfile = {
  names: string[];
  prompt: string;
  color: string | null;
  icon: string | null;
};

type PersonalityDoc = {
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
};

type Personality = {
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
  return join(process.cwd(), "packages", "shared-assets", "personalities");
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

  constructor(configDir: string) {
    this.userDir = join(configDir, "personalities");
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
}

export class PersonaService {
  private readonly defaultPersonas: string[];
  private readonly loader: PersonalityLoader;
  private identity: string | null = null;

  constructor(defaultPersonas: string[]) {
    this.defaultPersonas = defaultPersonas;
    this.loader = new PersonalityLoader(dirname(getConfigPath()));
  }

  get defaults(): string[] {
    return this.defaultPersonas;
  }

  setIdentity(identity: string | null): void {
    this.identity = identity;
  }

  async resolve(personas?: Iterable<string> | null): Promise<PersonaProfile> {
    const names = personas ? Array.from(personas) : this.defaultPersonas;
    const prompts: string[] = [];
    let color: string | null = null;
    let icon: string | null = null;

    for (let idx = 0; idx < names.length; idx += 1) {
      const name = names[idx] ?? "";
      if (!name) {
        continue;
      }
      const personality = await this.loader.load(name);
      if (idx === 0) {
        color = personality.color;
        icon = personality.icon;
      }
      prompts.push(personality.prompt_content);
    }

    let promptText = prompts.join("\n\n");
    if (this.identity) {
      promptText =
        `You are ${this.identity}. Unless asked otherwise, introduce yourself using this name.\n\n` +
        promptText;
    }

    return {
      names: names.filter(Boolean),
      prompt: promptText,
      color,
      icon,
    };
  }
}

export function normalizePersonaName(name: string): string {
  return basename(name, ".toml");
}
