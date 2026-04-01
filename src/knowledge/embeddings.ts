const GOOGLE_EMBEDDING_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001";

/**
 * Generates a 768-dimensional embedding for a single text string
 * using the Google Gemini Embedding API.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const [result] = await generateEmbeddings([text]);
  return result;
}

/**
 * Generates embeddings for a batch of texts.
 * Requires GOOGLE_API_KEY to be set — throws if missing.
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    throw new Error(
      "GOOGLE_API_KEY is not set. Embeddings require a valid Google API key.",
    );
  }

  const response = await fetch(
    `${GOOGLE_EMBEDDING_URL}:batchEmbedContents?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: "models/gemini-embedding-001",
          content: { parts: [{ text }] },
        })),
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Google Embedding API error ${response.status}: ${body}`,
    );
  }

  const json = (await response.json()) as GoogleBatchResponse;
  return json.embeddings.map((e) => e.values);
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface GoogleBatchResponse {
  embeddings: Array<{ values: number[] }>;
}
