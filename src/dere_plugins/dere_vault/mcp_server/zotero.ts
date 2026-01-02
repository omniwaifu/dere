import { parse } from "@iarna/toml";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type ZoteroConfig = {
  library_id: string;
  library_type: "user" | "group";
  api_key: string;
};

type ZoteroItemArgs = {
  key: string;
  title: string;
  authors: string[];
  year: number | null;
  publication: string | null;
  abstract: string | null;
  url: string | null;
  doi: string | null;
  tags: string[];
  citekey: string | null;
  item_type: string;
};

export class ZoteroItem {
  key: string;
  title: string;
  authors: string[];
  year: number | null;
  publication: string | null;
  abstract: string | null;
  url: string | null;
  doi: string | null;
  tags: string[];
  citekey: string | null;
  item_type: string;

  constructor(args: ZoteroItemArgs) {
    this.key = args.key;
    this.title = args.title;
    this.authors = args.authors;
    this.year = args.year;
    this.publication = args.publication;
    this.abstract = args.abstract;
    this.url = args.url;
    this.doi = args.doi;
    this.tags = args.tags;
    this.citekey = args.citekey;
    this.item_type = args.item_type;
  }

  formatAuthors(): string {
    return this.authors.join("; ");
  }

  formatFilename(useCitekey = false): string {
    if (useCitekey && this.citekey) {
      return `@${this.citekey}.md`;
    }

    const firstAuthor = this.authors.length ? this.authors[0].split(",")[0] : "unknown";
    const cleanTitle = this.title
      .slice(0, 50)
      .toLowerCase()
      .replace(/[\s/:'()"]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    const year = this.year ? String(this.year) : "nd";

    return `${firstAuthor.toLowerCase()}-${cleanTitle}-${year}.md`;
  }
}

export function loadConfig(): ZoteroConfig {
  const configPath = join(homedir(), ".config", "dere", "config.toml");

  if (!existsSync(configPath)) {
    throw new Error(
      `Config file not found: ${configPath}\n\n` +
        "Create config file with:\n" +
        "[zotero]\n" +
        'library_id = "12345"\n' +
        'library_type = "user"\n' +
        'api_key = "generate_at_zotero_org_settings_keys"\n\n' +
        "Generate API key at: https://www.zotero.org/settings/keys",
    );
  }

  const raw = parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
  const zoteroConfig = raw.zotero as Record<string, unknown> | undefined;
  if (!zoteroConfig) {
    throw new Error(
      "Error: [zotero] section missing in config.toml\n\n" +
        "Add to config file:\n" +
        "[zotero]\n" +
        'library_id = "12345"\n' +
        'library_type = "user"\n' +
        'api_key = "generate_at_zotero_org_settings_keys"',
    );
  }

  const required = ["library_id", "library_type", "api_key"];
  const missing = required.filter((field) => zoteroConfig[field] == null);
  if (missing.length) {
    throw new Error(`Missing required fields in [zotero] config: ${missing.join(", ")}`);
  }

  return {
    library_id: String(zoteroConfig.library_id),
    library_type: String(zoteroConfig.library_type) === "group" ? "group" : "user",
    api_key: String(zoteroConfig.api_key),
  };
}

function readFileSyncUtf8(path: string): string {
  return readFileSync(path, "utf-8");
}

type ZoteroItemResponse = {
  key?: string;
  version?: number;
  data?: Record<string, unknown>;
};

export class ZoteroClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: ZoteroConfig) {
    const libraryPath = config.library_type === "group" ? "groups" : "users";
    this.baseUrl = `https://api.zotero.org/${libraryPath}/${config.library_id}`;
    this.apiKey = config.api_key;
  }

  private async request<T>(args: {
    path: string;
    method?: string;
    query?: Record<string, string | number | boolean | null | undefined | string[]>;
    body?: unknown;
    headers?: Record<string, string>;
  }): Promise<{ data: T; raw: Response }> {
    const url = new URL(args.path, this.baseUrl);
    if (args.query) {
      for (const [key, value] of Object.entries(args.query)) {
        if (value === null || value === undefined) {
          continue;
        }
        if (Array.isArray(value)) {
          value.forEach((item) => url.searchParams.append(key, String(item)));
        } else {
          url.searchParams.append(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      "Zotero-API-Key": this.apiKey,
    };
    if (args.headers) {
      Object.assign(headers, args.headers);
    }

    let body: string | undefined;
    if (args.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(args.body);
    }

    const response = await fetch(url.toString(), {
      method: args.method ?? (body ? "POST" : "GET"),
      headers,
      body,
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Zotero API error ${response.status}: ${text}`);
    }

    const data = text ? (JSON.parse(text) as T) : (null as T);
    return { data, raw: response };
  }

  private async getItemRaw(key: string): Promise<ZoteroItemResponse> {
    const { data } = await this.request<ZoteroItemResponse>({
      path: `/items/${key}`,
    });
    return data;
  }

  async searchItems(query: string, searchType = "title"): Promise<ZoteroItem[]> {
    const { data } = await this.request<ZoteroItemResponse[]>({
      path: "/items",
      query: { q: query, limit: 100 },
    });

    const matches: ZoteroItem[] = [];
    for (const itemData of data ?? []) {
      const parsed = this.parseItem(itemData);
      if (!parsed) {
        continue;
      }

      if (searchType === "url") {
        if (parsed.url !== query) {
          continue;
        }
      } else if (searchType === "title") {
        if (!parsed.title.toLowerCase().includes(query.toLowerCase())) {
          continue;
        }
      } else if (searchType === "author") {
        const authorNames = parsed.authors.map((author) => author.toLowerCase());
        if (!authorNames.some((name) => name.includes(query.toLowerCase()))) {
          continue;
        }
      } else if (searchType === "citekey") {
        if (!parsed.citekey || !parsed.citekey.toLowerCase().includes(query.toLowerCase())) {
          continue;
        }
      }

      matches.push(parsed);
    }

    return matches;
  }

  async getItem(key: string): Promise<ZoteroItem | null> {
    try {
      const item = await this.getItemRaw(key);
      return this.parseItem(item);
    } catch {
      return null;
    }
  }

  async addItem(
    title: string,
    url?: string | null,
    author?: string | null,
    itemType = "webpage",
    abstract?: string | null,
    date?: string | null,
  ): Promise<string> {
    const { data: template } = await this.request<Record<string, unknown>>({
      path: "/items/new",
      query: { itemType },
    });

    const item = { ...template };
    item.title = title;

    if (url) {
      item.url = url;
    }
    if (abstract) {
      item.abstractNote = abstract;
    }
    if (date) {
      item.date = date;
    }
    if (author) {
      let first = "";
      let last = "";
      if (author.includes(",")) {
        const [lastPart, firstPart] = author.split(",", 2);
        last = lastPart.trim();
        first = (firstPart ?? "").trim();
      } else {
        const parts = author.trim().split(/\s+/);
        last = parts.pop() ?? "";
        first = parts.join(" ");
      }
      item.creators = [{ creatorType: "author", firstName: first, lastName: last }];
    }

    const { data } = await this.request<Record<string, any>>({
      path: "/items",
      method: "POST",
      body: [item],
    });

    if (data?.successful?.["0"]?.key) {
      return data.successful["0"].key as string;
    }

    throw new Error(`Failed to create item: ${JSON.stringify(data?.failed ?? data)}`);
  }

  async getCollections(): Promise<
    Record<string, { name: string; path: string; parent: string | null }>
  > {
    const { data } = await this.request<Array<Record<string, any>>>({
      path: "/collections",
    });

    const keyToName: Record<string, string> = {};
    const keyToParent: Record<string, string | null> = {};

    for (const coll of data ?? []) {
      const key = coll.key as string;
      const info = coll.data ?? {};
      keyToName[key] = info.name ?? "";
      keyToParent[key] = info.parentCollection ?? null;
    }

    const getPath = (key: string): string => {
      const parts: string[] = [];
      let current: string | null = key;
      while (current) {
        parts.unshift(keyToName[current] ?? "");
        current = keyToParent[current] ?? null;
      }
      return parts.join("/");
    };

    const result: Record<string, { name: string; path: string; parent: string | null }> = {};
    for (const key of Object.keys(keyToName)) {
      result[key] = {
        name: keyToName[key],
        path: getPath(key),
        parent: keyToParent[key] ?? null,
      };
    }

    return result;
  }

  async createCollection(name: string, parentKey?: string | null): Promise<string> {
    const payload: Record<string, unknown> = { name };
    if (parentKey) {
      payload.parentCollection = parentKey;
    }

    const { data } = await this.request<Record<string, any>>({
      path: "/collections",
      method: "POST",
      body: [payload],
    });

    if (data?.successful?.["0"]?.key) {
      return data.successful["0"].key as string;
    }

    throw new Error(`Failed to create collection: ${JSON.stringify(data?.failed ?? data)}`);
  }

  async addToCollection(itemKey: string, collectionKey: string): Promise<void> {
    const item = await this.getItemRaw(itemKey);
    const data = (item.data ?? {}) as Record<string, unknown>;
    const version = item.version ?? (data.version as number | undefined);

    const collections = Array.isArray(data.collections) ? [...data.collections] : [];
    if (!collections.includes(collectionKey)) {
      collections.push(collectionKey);
      data.collections = collections;
      await this.updateItem(itemKey, data, version);
    }
  }

  async listUnfiledItems(): Promise<ZoteroItem[]> {
    const { data } = await this.request<ZoteroItemResponse[]>({
      path: "/items",
      query: { limit: 100 },
    });

    const results: ZoteroItem[] = [];
    for (const itemData of data ?? []) {
      const parsed = this.parseItem(itemData);
      if (!parsed) {
        continue;
      }
      const dataObj = (itemData.data ?? {}) as Record<string, unknown>;
      const collections = Array.isArray(dataObj.collections) ? dataObj.collections : [];
      if (collections.length === 0) {
        results.push(parsed);
      }
    }
    return results;
  }

  async getAllTags(): Promise<string[]> {
    const { data } = await this.request<Array<Record<string, any>>>({
      path: "/tags",
      query: { limit: 100 },
    });
    if (!Array.isArray(data)) {
      return [];
    }
    return data
      .map((tag) => (typeof tag.tag === "string" ? tag.tag : null))
      .filter((tag): tag is string => Boolean(tag));
  }

  async addTags(itemKey: string, tagNames: string[]): Promise<void> {
    const item = await this.getItemRaw(itemKey);
    const data = (item.data ?? {}) as Record<string, unknown>;
    const version = item.version ?? (data.version as number | undefined);
    const existingTags = Array.isArray(data.tags)
      ? new Set(data.tags.map((tag: any) => tag?.tag).filter(Boolean))
      : new Set<string>();

    for (const tag of tagNames) {
      existingTags.add(tag);
    }

    data.tags = Array.from(existingTags).map((tag) => ({ tag }));
    await this.updateItem(itemKey, data, version);
  }

  async updateTags(itemKey: string, tagNames: string[]): Promise<void> {
    const item = await this.getItemRaw(itemKey);
    const data = (item.data ?? {}) as Record<string, unknown>;
    const version = item.version ?? (data.version as number | undefined);
    data.tags = tagNames.map((tag) => ({ tag }));
    await this.updateItem(itemKey, data, version);
  }

  async getItemCollections(itemKey: string): Promise<string[]> {
    const item = await this.getItemRaw(itemKey);
    const data = (item.data ?? {}) as Record<string, unknown>;
    const collectionKeys = Array.isArray(data.collections) ? data.collections : [];
    if (!collectionKeys.length) {
      return [];
    }
    const allCollections = await this.getCollections();
    return collectionKeys
      .map((key) => allCollections[key]?.path)
      .filter((value): value is string => Boolean(value));
  }

  private async updateItem(
    itemKey: string,
    data: Record<string, unknown>,
    version?: number,
  ): Promise<void> {
    await this.request<Record<string, unknown>>({
      path: `/items/${itemKey}`,
      method: "PUT",
      body: data,
      headers: version ? { "If-Unmodified-Since-Version": String(version) } : undefined,
    });
  }

  private parseItem(itemData: ZoteroItemResponse): ZoteroItem | null {
    const data = (itemData.data ?? itemData) as Record<string, any>;

    const itemType = data.itemType ?? "";
    if (["attachment", "note", "annotation"].includes(itemType)) {
      return null;
    }

    const key = data.key ?? itemData.key ?? "";
    const title = data.title ?? "Untitled";
    const url = data.url ?? null;
    const doi = data.DOI ?? null;
    const abstract = data.abstractNote ?? null;
    const publication = data.publicationTitle ?? data.journalAbbreviation ?? null;
    const creators = Array.isArray(data.creators) ? data.creators : [];
    const authors = creators
      .map((creator: any) => {
        if (creator.lastName && creator.firstName) {
          return `${creator.lastName}, ${creator.firstName}`;
        }
        return creator.name ?? creator.lastName ?? "";
      })
      .filter(Boolean);

    const dateStr = data.date ?? "";
    let year: number | null = null;
    if (dateStr) {
      const yearMatch = String(dateStr).split("-")[0];
      const parsedYear = Number.parseInt(yearMatch, 10);
      if (Number.isFinite(parsedYear)) {
        year = parsedYear;
      }
    }

    const tags = Array.isArray(data.tags)
      ? data.tags
          .map((tag: any) => (typeof tag.tag === "string" ? tag.tag : null))
          .filter((tag: string | null): tag is string => Boolean(tag))
      : [];

    const extra = data.extra ?? "";
    let citekey = this.extractCitekey(String(extra));
    if (!citekey) {
      citekey = this.getCitekeyFromBib(url);
    }
    if (!citekey) {
      const firstAuthor = authors.length ? authors[0] : null;
      citekey = this.generateCitekey(firstAuthor, title, year);
    }

    return new ZoteroItem({
      key,
      title,
      authors,
      year,
      publication,
      abstract,
      url,
      doi,
      tags,
      citekey,
      item_type: itemType,
    });
  }

  private extractCitekey(extra: string): string | null {
    for (const line of extra.split("\n")) {
      if (line.startsWith("Citation Key:")) {
        return line.replace("Citation Key:", "").trim();
      }
    }
    return null;
  }

  private normalizeString(value: string): string {
    return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  private generateCitekey(author: string | null, title: string, year: number | null): string {
    const stopWords = new Set([
      "a",
      "an",
      "the",
      "and",
      "or",
      "but",
      "for",
      "nor",
      "on",
      "at",
      "to",
      "from",
      "by",
      "of",
      "in",
      "with",
      "as",
      "against",
    ]);

    let authPart = "";
    if (author) {
      if (author.includes(",")) {
        authPart = author.split(",")[0].trim();
      } else {
        const parts = author.trim().split(/\s+/);
        authPart = parts.length ? parts[parts.length - 1] : "";
      }
      authPart = this.normalizeString(authPart).toLowerCase();
      authPart = authPart.replace(/[^a-z-]/g, "");
    }

    let titlePart = "";
    if (title) {
      const cleanTitle = this.normalizeString(title).replace(/[^\w\s]/g, " ");
      const words = cleanTitle.split(/\s+/).filter(Boolean);
      const significant = words.filter((word) => !stopWords.has(word.toLowerCase())).slice(0, 3);
      titlePart = significant.map((word) => word[0]?.toUpperCase() + word.slice(1)).join("");
      titlePart = titlePart.replace(/[^a-zA-Z0-9]/g, "");
    }

    const yearPart = year ? String(year) : "";
    return `${authPart}${titlePart}${yearPart}`;
  }

  private getCitekeyFromBib(itemUrl: string | null): string | null {
    if (!itemUrl) {
      return null;
    }

    const paths = [
      resolve(process.cwd(), "library.bib"),
      join(homedir(), "vault", "library.bib"),
      join(process.cwd(), "library.bib"),
    ];

    for (const bibPath of paths) {
      if (!existsSync(bibPath)) {
        continue;
      }
      try {
        const content = readFileSyncUtf8(bibPath);
        const pattern = /@\w+\{([^,]+),.*?howpublished\s*=\s*\{([^}]+)\}/gs;
        const matches = [...content.matchAll(pattern)];
        for (const match of matches) {
          const citekey = match[1]?.trim() ?? "";
          const bibUrl = match[2]?.replace(/\\textasciitilde/g, "~").trim() ?? "";
          if (bibUrl && (bibUrl.includes(itemUrl) || itemUrl.includes(bibUrl))) {
            return citekey;
          }
        }
      } catch {
        // ignore
      }
    }

    return null;
  }
}

export async function buildCollectionHierarchy(
  client: ZoteroClient,
  collectionPath: string,
): Promise<string> {
  const existing = await client.getCollections();
  const pathToKey: Record<string, string> = {};
  for (const [key, coll] of Object.entries(existing)) {
    pathToKey[coll.path] = key;
  }

  if (pathToKey[collectionPath]) {
    return pathToKey[collectionPath];
  }

  const parts = collectionPath.split("/");
  let parentKey: string | null = null;

  for (let i = 0; i < parts.length; i += 1) {
    const pathSoFar = parts.slice(0, i + 1).join("/");
    if (pathToKey[pathSoFar]) {
      parentKey = pathToKey[pathSoFar];
    } else {
      const newKey = await client.createCollection(parts[i], parentKey);
      pathToKey[pathSoFar] = newKey;
      parentKey = newKey;
    }
  }

  return parentKey ?? "";
}

function renderLiteratureNote(args: {
  item: ZoteroItem;
  collectionPaths: string[];
  today: string;
}): string {
  const lines: string[] = ["---"];

  const title = args.item.title.replace(/"/g, '\\"');
  lines.push(`title: "${title}"`);
  lines.push(`authors: ${args.item.formatAuthors()}`);
  lines.push(`year: ${args.item.year ?? "n.d."}`);

  if (args.item.publication) {
    lines.push(`publication: "${args.item.publication.replace(/"/g, '\\"')}"`);
  }
  if (args.item.citekey) {
    lines.push(`citekey: "@${args.item.citekey}"`);
  }
  if (args.item.url) {
    lines.push(`url: ${args.item.url}`);
  }
  if (args.item.doi) {
    lines.push(`doi: ${args.item.doi}`);
  }

  lines.push("tags:");
  for (const path of args.collectionPaths) {
    const normalized = path.toLowerCase().replace(/ /g, "-");
    lines.push(`  - domain/${normalized}`);
  }
  for (const tag of args.item.tags) {
    lines.push(`  - ${tag}`);
  }

  lines.push(`date: ${args.today}`);
  lines.push("---", "", `# ${args.item.title}`, "");

  if (args.item.abstract) {
    lines.push(args.item.abstract);
  } else {
    lines.push("_(No abstract available)_");
  }

  lines.push("", "## Notes", "");
  return lines.join("\n");
}

export class VaultIntegration {
  private readonly vaultPath: string;
  private readonly templateDir: string;

  constructor(vaultPath?: string | null, templateDir?: string | null) {
    this.vaultPath = vaultPath ?? this.findVault();
    if (!this.vaultPath) {
      throw new Error("Could not auto-detect vault. Provide vault_path.");
    }

    const filePath = fileURLToPath(import.meta.url);
    this.templateDir =
      templateDir ?? join(dirname(filePath), "..", "skills", "source", "tools", "templates");

    if (!existsSync(this.templateDir)) {
      throw new Error(`Template directory not found: ${this.templateDir}`);
    }

    const defaultTemplate = join(this.templateDir, "zotlit-default.md.j2");
    if (!existsSync(defaultTemplate)) {
      throw new Error(
        `Template not found: ${defaultTemplate}. Ensure zotlit-default.md.j2 exists in the templates directory.`,
      );
    }
  }

  private findVault(): string {
    let current = resolve(process.cwd());
    while (true) {
      if (existsSync(join(current, ".obsidian"))) {
        return current;
      }
      const parent = dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }

    const candidates = [
      join(homedir(), "vault"),
      join(homedir(), "Vault"),
      join(homedir(), "Documents", "vault"),
      join(homedir(), "Obsidian"),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate) && existsSync(join(candidate, ".obsidian"))) {
        return candidate;
      }
    }

    return "";
  }

  async createLiteratureNote(
    item: ZoteroItem,
    useCitekeyNaming = false,
    collectionPaths: string[] = [],
  ): Promise<string> {
    const today = new Date().toISOString().slice(0, 10);
    const content = renderLiteratureNote({ item, collectionPaths, today });

    const filename = item.formatFilename(useCitekeyNaming);
    const notePath = join(this.vaultPath, "Literature", filename);

    if (existsSync(notePath)) {
      throw new Error(`Note already exists: ${notePath}`);
    }

    await mkdir(dirname(notePath), { recursive: true });
    await writeFile(notePath, content, "utf-8");

    return notePath;
  }
}
