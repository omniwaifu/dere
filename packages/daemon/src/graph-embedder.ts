import { loadConfig } from "@dere/shared-config";

function chunkText(text: string, maxChars: number, overlap: number): string[] {
  if (text.length <= maxChars) {
    return [text];
  }
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + maxChars, text.length);
    chunks.push(text.slice(start, end));
    if (end >= text.length) {
      break;
    }
    start = Math.max(0, end - overlap);
  }
  return chunks;
}

function averageEmbeddings(embeddings: number[][]): number[] {
  if (embeddings.length === 0) {
    return [];
  }
  if (embeddings.length === 1) {
    return embeddings[0];
  }
  const dim = embeddings[0].length;
  const avg = new Array(dim).fill(0);
  for (const embedding of embeddings) {
    for (let i = 0; i < dim; i += 1) {
      avg[i] += embedding[i] ?? 0;
    }
  }
  return avg.map((value) => value / embeddings.length);
}

export class OpenAIEmbedder {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly embeddingDim: number;

  constructor(apiKey: string, model: string, embeddingDim: number) {
    this.apiKey = apiKey;
    this.model = model;
    this.embeddingDim = embeddingDim;
  }

  static async fromConfig(): Promise<OpenAIEmbedder> {
    const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENAI_KEY;
    if (!apiKey) {
      throw new Error("OpenAI API key not configured");
    }
    const config = await loadConfig();
    const graphConfig = (config.dere_graph ?? {}) as Record<string, unknown>;
    const embeddingDim =
      typeof graphConfig.embedding_dim === "number" ? graphConfig.embedding_dim : 1536;
    return new OpenAIEmbedder(apiKey, "text-embedding-3-small", embeddingDim);
  }

  async create(text: string): Promise<number[]> {
    const chunks = chunkText(text, 32000, 800);
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: chunks,
      }),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`OpenAI embeddings failed: ${message}`);
    }

    const data = (await response.json()) as { data?: Array<{ embedding: number[] }> };
    const embeddings = (data.data ?? []).map((item) => item.embedding.slice(0, this.embeddingDim));
    return averageEmbeddings(embeddings);
  }

  async createBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`OpenAI embeddings failed: ${message}`);
    }

    const data = (await response.json()) as { data?: Array<{ embedding: number[] }> };
    const embeddings = (data.data ?? []).map((item) => item.embedding.slice(0, this.embeddingDim));
    return embeddings;
  }
}
