import { parse, stringify } from "@iarna/toml";
import { readdir, readFile, writeFile, mkdir, stat, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../init.js";
import { getConfigPath } from "@dere/shared-config";

type TomlValue = boolean | number | string | Date | TomlMap | TomlArray;
type TomlArray = TomlValue[] | TomlValue[][];
type TomlMap = { [key: string]: TomlValue | TomlArray };
type PersonalityDoc = TomlMap;

function embeddedDir(): string {
  const envDir = process.env.DERE_EMBEDDED_PERSONALITIES_DIR;
  if (envDir) {
    return envDir;
  }
  return join(process.cwd(), "packages", "shared-assets", "personalities");
}

function userDir(): string {
  return join(dirname(getConfigPath()), "personalities");
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

async function readToml(path: string): Promise<PersonalityDoc> {
  const raw = await readFile(path, "utf-8");
  return parse(raw) as PersonalityDoc;
}

async function loadPersonalityData(
  name: string,
): Promise<{ data: PersonalityDoc; isOverride: boolean; hasEmbedded: boolean }> {
  const embeddedPath = join(embeddedDir(), `${name}.toml`);
  const userPath = join(userDir(), `${name}.toml`);
  let hasEmbedded = false;
  try {
    await stat(embeddedPath);
    hasEmbedded = true;
  } catch {
    hasEmbedded = false;
  }

  try {
    const data = await readToml(userPath);
    return { data, isOverride: true, hasEmbedded };
  } catch {
    if (!hasEmbedded) {
      throw new Error(`Personality '${name}' not found`);
    }
    const data = await readToml(embeddedPath);
    return { data, isOverride: false, hasEmbedded };
  }
}

export const personalitiesRouter = router({
  list: publicProcedure.query(async () => {
    const embeddedNames = await listTomlNames(embeddedDir());
    const userNames = await listTomlNames(userDir());
    const nameSet = new Set([...embeddedNames, ...userNames]);

    const personalities = [];
    for (const name of Array.from(nameSet).sort()) {
      const hasEmbedded = embeddedNames.includes(name);
      const hasUser = userNames.includes(name);
      const source = hasUser ? "user" : "embedded";
      let data: PersonalityDoc | null = null;
      try {
        data = await readToml(
          hasUser ? join(userDir(), `${name}.toml`) : join(embeddedDir(), `${name}.toml`),
        );
      } catch {
        data = null;
      }
      const metadata = (data?.metadata ?? {}) as Record<string, unknown>;
      const display = (data?.display ?? {}) as TomlMap;

      personalities.push({
        name,
        short_name: typeof metadata.short_name === "string" ? metadata.short_name : "",
        color: typeof display.color === "string" ? display.color : "white",
        icon: typeof display.icon === "string" ? display.icon : "*",
        source,
        has_embedded: hasEmbedded,
      });
    }

    return { personalities };
  }),

  get: publicProcedure.input(z.object({ name: z.string() })).query(async ({ input }) => {
    try {
      const { data, isOverride, hasEmbedded } = await loadPersonalityData(input.name);
      return {
        data: data as Record<string, unknown>,
        is_override: isOverride,
        has_embedded: hasEmbedded,
      };
    } catch (error) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: String(error),
      });
    }
  }),

  save: publicProcedure
    .input(
      z.object({
        name: z.string(),
        data: z.record(z.string(), z.unknown()),
      })
    )
    .mutation(async ({ input }) => {
      try {
        await mkdir(userDir(), { recursive: true });
        const targetPath = join(userDir(), `${input.name}.toml`);
        await writeFile(targetPath, stringify(input.data as TomlMap), "utf-8");
        return { status: "saved", name: input.name };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: String(error),
        });
      }
    }),

  delete: publicProcedure.input(z.object({ name: z.string() })).mutation(async ({ input }) => {
    const embeddedPath = join(embeddedDir(), `${input.name}.toml`);
    const userPath = join(userDir(), `${input.name}.toml`);

    let hasEmbedded = false;
    try {
      await stat(embeddedPath);
      hasEmbedded = true;
    } catch {
      hasEmbedded = false;
    }

    let deleted = false;
    try {
      await unlink(userPath);
      deleted = true;
    } catch {
      deleted = false;
    }

    if (!deleted && !hasEmbedded) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Personality '${input.name}' not found`,
      });
    }
    if (!deleted && hasEmbedded) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Cannot delete embedded personality '${input.name}'`,
      });
    }

    return {
      status: hasEmbedded ? "reverted" : "deleted",
      name: input.name,
      has_embedded: hasEmbedded,
    };
  }),
});
