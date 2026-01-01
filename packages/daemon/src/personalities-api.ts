import { parse, stringify } from "@iarna/toml";
import { readdir, readFile, writeFile, mkdir, stat, unlink } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";

import { getConfigPath } from "@dere/shared-config";
import type { Hono } from "hono";

type PersonalityDoc = Record<string, unknown>;

const AVATAR_ALLOWED_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

function embeddedDir(): string {
  const envDir = process.env.DERE_EMBEDDED_PERSONALITIES_DIR;
  if (envDir) {
    return envDir;
  }
  return join(process.cwd(), "src", "dere_shared", "personalities");
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

function sanitizeStem(stem: string): string {
  const safe = stem
    .toLowerCase()
    .split("")
    .map((ch) => (/[a-z0-9._-]/.test(ch) ? ch : "_"))
    .join("");
  const trimmed = safe.replace(/^[_\-.]+|[_\-.]+$/g, "");
  return trimmed || "avatar";
}

function avatarContentType(ext: string): string {
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

export function registerPersonalityRoutes(app: Hono): void {
  app.get("/personalities", async () => {
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
      const display = (data?.display ?? {}) as Record<string, unknown>;

      personalities.push({
        name,
        short_name: typeof metadata.short_name === "string" ? metadata.short_name : "",
        color: typeof display.color === "string" ? display.color : "white",
        icon: typeof display.icon === "string" ? display.icon : "*",
        source,
        has_embedded: hasEmbedded,
      });
    }

    return new Response(JSON.stringify({ personalities }), {
      headers: { "content-type": "application/json" },
    });
  });

  app.get("/personalities/:name", async (c) => {
    const name = c.req.param("name");
    try {
      const { data, isOverride, hasEmbedded } = await loadPersonalityData(name);
      return c.json({ data, is_override: isOverride, has_embedded: hasEmbedded });
    } catch (error) {
      return c.json({ error: String(error) }, 404);
    }
  });

  app.put("/personalities/:name", async (c) => {
    const name = c.req.param("name");
    let payload: PersonalityDoc;
    try {
      payload = (await c.req.json()) as PersonalityDoc;
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    try {
      await mkdir(userDir(), { recursive: true });
      const targetPath = join(userDir(), `${name}.toml`);
      await writeFile(targetPath, stringify(payload), "utf-8");
      return c.json({ status: "saved", name });
    } catch (error) {
      return c.json({ error: String(error) }, 400);
    }
  });

  app.post("/personalities/:name/avatar", async (c) => {
    const name = c.req.param("name");
    let data: PersonalityDoc;
    try {
      data = (await loadPersonalityData(name)).data;
    } catch (error) {
      return c.json({ error: String(error) }, 404);
    }

    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return c.json({ error: "Invalid multipart form data" }, 400);
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      return c.json({ error: "file is required" }, 400);
    }

    const suffix = extname(file.name).toLowerCase();
    if (!AVATAR_ALLOWED_EXTS.has(suffix)) {
      return c.json(
        {
          error: `Unsupported file type. Allowed: ${Array.from(AVATAR_ALLOWED_EXTS).sort().join(", ")}`,
        },
        400,
      );
    }

    const buffer = new Uint8Array(await file.arrayBuffer());
    if (buffer.byteLength > AVATAR_MAX_BYTES) {
      return c.json({ error: "Avatar too large (max 5MB)" }, 413);
    }

    const metadata = (data.metadata ?? {}) as Record<string, unknown>;
    const display = (data.display ?? {}) as Record<string, unknown>;
    const shortName =
      (typeof metadata.short_name === "string" && metadata.short_name) ||
      (typeof metadata.name === "string" && metadata.name) ||
      name;
    const safeStem = sanitizeStem(String(shortName));

    const personalitiesDir = join(userDir());
    const avatarsDir = join(personalitiesDir, "avatars");
    await mkdir(avatarsDir, { recursive: true });

    const targetName = `${safeStem}${suffix}`;
    const targetPath = join(avatarsDir, targetName);
    await writeFile(targetPath, buffer);

    const relPath = `avatars/${targetName}`;
    display.avatar = relPath;
    data.display = display;

    await mkdir(userDir(), { recursive: true });
    await writeFile(join(userDir(), `${name}.toml`), stringify(data), "utf-8");

    return c.json({ status: "ok", avatar: relPath });
  });

  app.get("/personalities/:name/avatar", async (c) => {
    const name = c.req.param("name");
    let data: PersonalityDoc;
    try {
      data = (await loadPersonalityData(name)).data;
    } catch (error) {
      return c.json({ error: String(error) }, 404);
    }

    const display = (data.display ?? {}) as Record<string, unknown>;
    const avatarRel = typeof display.avatar === "string" ? display.avatar : null;
    if (!avatarRel) {
      return c.json({ error: "No avatar set" }, 404);
    }

    const personalitiesDir = resolve(userDir());
    const avatarPath = resolve(join(personalitiesDir, avatarRel));
    if (!avatarPath.startsWith(personalitiesDir)) {
      return c.json({ error: "Invalid avatar path" }, 400);
    }

    try {
      const content = await readFile(avatarPath);
      const contentType = avatarContentType(extname(avatarPath).toLowerCase());
      return new Response(content, { headers: { "content-type": contentType } });
    } catch {
      return c.json({ error: "Avatar file not found" }, 404);
    }
  });

  app.delete("/personalities/:name", async (c) => {
    const name = c.req.param("name");
    const embeddedPath = join(embeddedDir(), `${name}.toml`);
    const userPath = join(userDir(), `${name}.toml`);

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
      return c.json({ error: `Personality '${name}' not found` }, 404);
    }
    if (!deleted && hasEmbedded) {
      return c.json({ error: `Cannot delete embedded personality '${name}'` }, 400);
    }

    return c.json({
      status: hasEmbedded ? "reverted" : "deleted",
      name,
      has_embedded: hasEmbedded,
    });
  });
}
