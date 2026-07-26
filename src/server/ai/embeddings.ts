/**
 * Embeddings — local, in-process, no API key, no network at query time.
 *
 * ## What runs here
 * `Xenova/multilingual-e5-small` as int8-quantised ONNX, executed by
 * `@huggingface/transformers` (transformers.js v3) inside the same Node process
 * that serves requests. Roughly 120 MB on disk quantised, 384 dimensions,
 * 12 layers over an XLM-RoBERTa vocabulary that covers 100 languages —
 * French, Arabic, English and Spanish all first class, which is the
 * non-negotiable requirement here and the reason a small English-only model
 * (bge-small, all-MiniLM-L6) is not an option however much faster it is.
 *
 * E5 is trained for *asymmetric* retrieval: a short question is embedded with a
 * `query:` prefix, a passage of course material with a `passage:` prefix, and
 * the two spaces are aligned during training. That is the same distinction
 * Voyage expressed as `input_type`, and it is why {@link embed} takes an
 * `inputType` — using the wrong prefix silently degrades recall by a few points
 * with no error anywhere, so it is centralised here and never at a call site.
 *
 * ## Why local
 * A hosted embedding API means a key to rotate, a per-call cost, a rate limit,
 * a network round trip in the retrieval path, and a vendor whose outage becomes
 * our outage — all for a few thousand chunks that a CPU embeds in milliseconds.
 * Locally there is nothing to bill and nothing to be down. See
 * `docs/DECISIONS.md`.
 *
 * ## Resource discipline
 * CFI runs as **one** shared Node process (§2 C1). Inference is CPU-bound and
 * synchronous inside ONNX Runtime, so two concurrent embed calls would compete
 * for the same cores and stall request handling. Every call therefore goes
 * through a strict serial queue — {@link MAX_CONCURRENCY} is 1 and is not a
 * tunable — and texts are batched so a re-index does one forward pass per
 * {@link MAX_BATCH_SIZE} chunks instead of one per chunk.
 *
 * The model is loaded lazily on first use and cached for the process lifetime.
 * Call {@link warmup} from `/api/health` (or a boot hook) to pay the ~2 s load
 * once, off the critical path, instead of inside the first student's question.
 */

/* ────────────────────────────────────────────────────────────────────────────
 * Model identity
 * ────────────────────────────────────────────────────────────────────────── */

/** The Hugging Face repository id. Overridable with `AI_EMBEDDING_MODEL`. */
export const DEFAULT_EMBEDDING_MODEL = 'Xenova/multilingual-e5-small';

/**
 * Output dimension. Stored in `KnowledgeChunk.embedding` as a little-endian
 * Float32 buffer of exactly `EMBEDDING_DIM * 4` bytes.
 *
 * Changing the model changes this number, which invalidates every stored
 * vector — which is precisely why `KnowledgeChunk.embeddingModel` exists and
 * why {@link unpackEmbedding} refuses a buffer of the wrong length instead of
 * silently reading garbage.
 */
export const EMBEDDING_DIM = 384;

/**
 * `q8` — int8 dynamic quantisation. Roughly a quarter of the fp32 download and
 * memory, two to three times faster on CPU, and a retrieval-quality loss small
 * enough to disappear under the similarity floor. `fp32` is available by
 * setting `AI_EMBEDDING_DTYPE` if a measurement ever says otherwise.
 */
export const DEFAULT_EMBEDDING_DTYPE = 'q8';

/** Texts per forward pass. Larger batches help throughput; memory grows with it. */
export const MAX_BATCH_SIZE = 16;

/**
 * Characters kept per text. E5's context is 512 tokens; at the ~2.7 characters
 * per token a French/Arabic mix costs on this tokenizer, 1200 characters sits
 * just under it. The tokenizer truncates anyway — this only avoids paying to
 * tokenize text that will be discarded.
 */
export const MAX_INPUT_CHARS = 1_200;

/** One at a time, always. See the resource-discipline note above. */
export const MAX_CONCURRENCY = 1;

/** E5 requires these exact prefixes, trailing space included. */
const PREFIXES = { query: 'query: ', document: 'passage: ' } as const;

export type EmbeddingInputType = keyof typeof PREFIXES;

/* ────────────────────────────────────────────────────────────────────────────
 * Errors
 * ────────────────────────────────────────────────────────────────────────── */

export type EmbeddingErrorCode =
  /** The optional dependency is absent, or the weights could not be fetched. */
  | 'load_failed'
  /** The model returned a different dimension than {@link EMBEDDING_DIM}. */
  | 'dimension_mismatch'
  /** Empty input, or a stored buffer whose length is not a whole vector. */
  | 'invalid_input'
  /** Inference threw. */
  | 'inference_failed';

export class EmbeddingError extends Error {
  readonly code: EmbeddingErrorCode;

  constructor(code: EmbeddingErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'EmbeddingError';
    this.code = code;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * The transformers.js surface we depend on
 *
 * Declared locally and verified at runtime rather than imported as types. Two
 * reasons, both practical:
 *
 *   1. `@huggingface/transformers` is an *optional* dependency — a checkout
 *      that never touches the assistant should not have to download 100 MB of
 *      ONNX Runtime, and this file must type-check before it is installed.
 *   2. The specifier is hidden from the bundler behind an indirect `import()`,
 *      so Next never tries to trace a native module into the server bundle.
 *      Add `serverExternalPackages: ['@huggingface/transformers']` in
 *      `next.config.ts` and it stays external in every build mode.
 *
 * Nothing untyped escapes: {@link asTransformersModule} narrows the loaded
 * namespace before a single property is read, and an unexpected shape becomes
 * a `load_failed` error rather than a crash three lines later.
 * ────────────────────────────────────────────────────────────────────────── */

interface FeatureExtractionOutput {
  /** Flat `[batch × dim]` row-major buffer. */
  readonly data: Float32Array;
  /** `[batch, dim]`. */
  readonly dims: readonly number[];
}

type FeatureExtractionPipeline = (
  texts: string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<FeatureExtractionOutput>;

interface TransformersModule {
  pipeline: (
    task: 'feature-extraction',
    model: string,
    options: { dtype: string },
  ) => Promise<FeatureExtractionPipeline>;
}

type DynamicImport = (specifier: string) => Promise<unknown>;

/**
 * An `import()` the bundler and the type checker both leave alone. `new
 * Function` is the only construct that is opaque to webpack's static analysis
 * *and* to module resolution, which is exactly what an optional native
 * dependency needs. Server-only code; there is no CSP in play.
 */
const importModule = new Function('specifier', 'return import(specifier);') as DynamicImport;

function asTransformersModule(loaded: unknown): TransformersModule {
  if (typeof loaded !== 'object' || loaded === null || !('pipeline' in loaded)) {
    throw new EmbeddingError(
      'load_failed',
      '@huggingface/transformers loaded but exports no `pipeline`. Expected transformers.js v3.',
    );
  }
  const { pipeline } = loaded as { pipeline: unknown };
  if (typeof pipeline !== 'function') {
    throw new EmbeddingError('load_failed', '@huggingface/transformers `pipeline` is not callable.');
  }
  return { pipeline } as TransformersModule;
}

function isFeatureExtractionOutput(value: unknown): value is FeatureExtractionOutput {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { data?: unknown; dims?: unknown };
  return candidate.data instanceof Float32Array && Array.isArray(candidate.dims);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Configuration
 * ────────────────────────────────────────────────────────────────────────── */

export interface EmbeddingsConfig {
  readonly modelId: string;
  readonly dtype: string;
}

function readConfig(): EmbeddingsConfig {
  const source: Record<string, string | undefined> =
    typeof process === 'undefined' ? {} : process.env;
  const modelId = (source.AI_EMBEDDING_MODEL ?? '').trim();
  const dtype = (source.AI_EMBEDDING_DTYPE ?? '').trim();
  return {
    modelId: modelId.length > 0 ? modelId : DEFAULT_EMBEDDING_MODEL,
    dtype: dtype.length > 0 ? dtype : DEFAULT_EMBEDDING_DTYPE,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Lazy load + serial execution
 * ────────────────────────────────────────────────────────────────────────── */

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;
let loadedAt: number | null = null;
let queue: Promise<unknown> = Promise.resolve();

/**
 * Run `task` after everything already queued, whether that finished or threw.
 * A failed embed must not wedge the queue for the process lifetime.
 */
function serialise<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task, task);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function loadPipeline(): Promise<FeatureExtractionPipeline> {
  if (pipelinePromise !== null) return pipelinePromise;

  const config = readConfig();
  const attempt = (async (): Promise<FeatureExtractionPipeline> => {
    let loaded: unknown;
    try {
      loaded = await importModule('@huggingface/transformers');
    } catch (cause) {
      throw new EmbeddingError(
        'load_failed',
        'Cannot load @huggingface/transformers. Install it (`npm i @huggingface/transformers`) — see docs/AI.md.',
        { cause },
      );
    }
    try {
      const transformers = asTransformersModule(loaded);
      const extractor = await transformers.pipeline('feature-extraction', config.modelId, {
        dtype: config.dtype,
      });
      loadedAt = Date.now();
      return extractor;
    } catch (cause) {
      if (cause instanceof EmbeddingError) throw cause;
      throw new EmbeddingError(
        'load_failed',
        `Cannot initialise the embedding model "${config.modelId}" (dtype ${config.dtype}).`,
        { cause },
      );
    }
  })();

  // A failed load must be retryable: drop the cached promise so the next caller
  // tries again instead of inheriting a rejection forever.
  pipelinePromise = attempt.catch((error: unknown) => {
    pipelinePromise = null;
    throw error;
  });
  return pipelinePromise;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Public API
 * ────────────────────────────────────────────────────────────────────────── */

export interface EmbedOptions {
  /**
   * `'document'` (default) for content being indexed, `'query'` for a student's
   * question. Must match how the corpus was embedded — see the E5 note above.
   */
  readonly inputType?: EmbeddingInputType;
}

/**
 * Embed texts into unit-length vectors of {@link EMBEDDING_DIM} dimensions.
 *
 * Output order matches input order. Vectors are L2-normalised by the pipeline,
 * so cosine similarity is a plain dot product — which is what makes the
 * in-memory search in §16.3 cheap.
 *
 * ```ts
 * const [q] = await embed([question], { inputType: 'query' });
 * const vectors = await embed(chunks.map((c) => c.content)); // documents
 * ```
 */
export function embed(
  texts: readonly string[],
  options: EmbedOptions = {},
): Promise<Float32Array[]> {
  if (texts.length === 0) return Promise.resolve([]);

  const prefix = PREFIXES[options.inputType ?? 'document'];
  const prepared = texts.map((text) => prefix + normaliseInput(text));
  if (prepared.some((text) => text === prefix)) {
    return Promise.reject(
      new EmbeddingError('invalid_input', 'Cannot embed an empty or whitespace-only text.'),
    );
  }

  return serialise(async () => {
    const extractor = await loadPipeline();
    const vectors: Float32Array[] = [];
    for (let start = 0; start < prepared.length; start += MAX_BATCH_SIZE) {
      const batch = prepared.slice(start, start + MAX_BATCH_SIZE);
      vectors.push(...(await runBatch(extractor, batch)));
    }
    return vectors;
  });
}

async function runBatch(
  extractor: FeatureExtractionPipeline,
  batch: string[],
): Promise<Float32Array[]> {
  let output: unknown;
  try {
    output = await extractor(batch, { pooling: 'mean', normalize: true });
  } catch (cause) {
    throw new EmbeddingError('inference_failed', 'The embedding model failed on a batch.', {
      cause,
    });
  }

  if (!isFeatureExtractionOutput(output)) {
    throw new EmbeddingError(
      'inference_failed',
      'The embedding pipeline returned an unexpected shape (no Float32 `data`/`dims`).',
    );
  }

  const dim = output.dims.at(-1);
  if (dim !== EMBEDDING_DIM) {
    throw new EmbeddingError(
      'dimension_mismatch',
      `Model returned ${String(dim)} dimensions, expected ${EMBEDDING_DIM}. ` +
        'Stored vectors and the query vector must come from the same model.',
    );
  }
  if (output.data.length !== batch.length * EMBEDDING_DIM) {
    throw new EmbeddingError(
      'inference_failed',
      `Expected ${batch.length * EMBEDDING_DIM} floats, got ${output.data.length}.`,
    );
  }

  const vectors: Float32Array[] = [];
  for (let index = 0; index < batch.length; index += 1) {
    // `slice`, not `subarray`: each vector must own its memory so the batch
    // buffer can be collected and so a caller cannot mutate its neighbour.
    vectors.push(output.data.slice(index * EMBEDDING_DIM, (index + 1) * EMBEDDING_DIM));
  }
  return vectors;
}

function normaliseInput(text: string): string {
  const collapsed = text.replace(/\s+/gu, ' ').trim();
  return collapsed.length > MAX_INPUT_CHARS ? collapsed.slice(0, MAX_INPUT_CHARS) : collapsed;
}

export interface EmbeddingsStatus {
  readonly modelId: string;
  readonly dimension: number;
  readonly dtype: string;
  readonly loaded: boolean;
  /** Milliseconds since the model finished loading, or `null` if it has not. */
  readonly loadedAgoMs: number | null;
}

/** Current state, without triggering a load. Safe to call from anywhere. */
export function embeddingsStatus(): EmbeddingsStatus {
  const config = readConfig();
  return {
    modelId: config.modelId,
    dimension: EMBEDDING_DIM,
    dtype: config.dtype,
    loaded: loadedAt !== null,
    loadedAgoMs: loadedAt === null ? null : Date.now() - loadedAt,
  };
}

/**
 * Load the model and run one throwaway embedding, so the first real question
 * does not pay for it. Idempotent, serialised with everything else, and safe to
 * call on every health poll — after the first success it is a no-op.
 */
export async function warmup(): Promise<EmbeddingsStatus> {
  await embed(['warmup'], { inputType: 'query' });
  return embeddingsStatus();
}

/* ────────────────────────────────────────────────────────────────────────────
 * Vector helpers — pure, no model needed
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Cosine similarity. Both arguments are expected to be L2-normalised (they are,
 * coming out of {@link embed}), in which case this is a dot product; the
 * normalising divisor is kept so the function is still correct for a vector
 * that came from somewhere else.
 */
export function cosineSimilarity(left: Float32Array, right: Float32Array): number {
  if (left.length !== right.length || left.length === 0) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

/**
 * Vector → `Bytes` column payload, explicitly little-endian.
 *
 * `Float32Array`'s own byte order follows the host CPU. Every realistic target
 * is little-endian, but "realistic" is not "guaranteed", and a corpus written
 * on one endianness and read on another would produce silently meaningless
 * similarities rather than an error. Writing the bytes explicitly costs
 * microseconds and removes the question.
 */
export function packEmbedding(vector: Float32Array): Buffer {
  const buffer = Buffer.allocUnsafe(vector.length * 4);
  for (let index = 0; index < vector.length; index += 1) {
    buffer.writeFloatLE(vector[index] ?? 0, index * 4);
  }
  return buffer;
}

/** `Bytes` column payload → vector. Throws on a length that is not a whole vector. */
export function unpackEmbedding(buffer: Buffer, dimension: number = EMBEDDING_DIM): Float32Array {
  if (buffer.byteLength !== dimension * 4) {
    throw new EmbeddingError(
      'invalid_input',
      `Stored embedding is ${buffer.byteLength} bytes, expected ${dimension * 4} ` +
        `(${dimension} float32). The chunk was embedded with a different model.`,
    );
  }
  const vector = new Float32Array(dimension);
  for (let index = 0; index < dimension; index += 1) {
    vector[index] = buffer.readFloatLE(index * 4);
  }
  return vector;
}

/** Test seam: forget the loaded model so the next call reloads it. */
export function resetEmbeddingsForTests(): void {
  pipelinePromise = null;
  loadedAt = null;
  queue = Promise.resolve();
}
