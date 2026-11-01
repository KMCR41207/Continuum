export interface EmbeddingProvider {
  model: string;
  dimensions: 384;
  embed(text: string): Promise<number[]>;
}
/** Configurable OpenAI-compatible embeddings HTTP contract. No lexical vectors masquerade as semantic embeddings. */
export function embeddingProvider(
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): EmbeddingProvider | null {
  if (!env.EMBEDDING_URL || !env.EMBEDDING_MODEL || !env.EMBEDDING_API_KEY)
    return null;
  const url = new URL(env.EMBEDDING_URL);
  if (url.protocol !== "https:")
    throw new Error("Embedding endpoint must use HTTPS");
  const model = env.EMBEDDING_MODEL;
  return {
    model,
    dimensions: 384,
    async embed(text) {
      if (text.length > 4000) throw new Error("Embedding input too long");
      const response = await fetcher(url, {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${env.EMBEDDING_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, input: text, dimensions: 384 }),
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error("Embedding provider failed");
      const data = await response.json();
      const values = data.data?.[0]?.embedding;
      if (
        !Array.isArray(values) ||
        values.length !== 384 ||
        values.some((x) => typeof x !== "number" || !Number.isFinite(x)) ||
        values.every((x) => x === 0)
      )
        throw new Error(
          "Embedding dimension/value mismatch; expected 384 finite values",
        );
      return values;
    },
  };
}
