/**
 * `@/server/ai` — the assistant's foundation (§16).
 *
 * Three independent pieces, deliberately not coupled to each other:
 *
 * - `answer-policy` — pure tier logic. Curated → grounded → refuse. No I/O.
 * - `embeddings`    — local ONNX sentence embeddings. No key, no network.
 * - `provider`      — generation over an OpenAI-compatible endpoint, or none.
 *
 * Retrieval, the chat route, the dock UI and the ingestion job are M7 and live
 * elsewhere; they consume this module rather than the other way round.
 *
 * The one rule everything here serves: **the assistant answers exactly, answers
 * with a citation, or refuses.** See `docs/AI.md` for what that does and does
 * not promise.
 */

export {
  type AnswerDecision,
  type Candidate,
  type CandidateSource,
  type ChunkCandidate,
  type CitationVerdict,
  type ClassifyOptions,
  type CuratedCandidate,
  type CuratedDecision,
  type CuratedSource,
  type GroundedDecision,
  type RefusalReason,
  type RefuseDecision,
  classify,
  COSINE_NOISE_FLOOR,
  CURATED_FLOOR,
  enforceGrounding,
  GROUNDING_FLOOR,
  isExactCuratedMatch,
  MAX_GROUNDED_CHARS,
  MAX_GROUNDED_CHUNKS,
  MIN_CITATIONS,
  MIN_QUERY_CHARS,
  normaliseQuestion,
  requiresGeneration,
  rescaleCosine,
  verifyCitations,
} from './answer-policy';

export {
  type EmbeddingErrorCode,
  type EmbeddingInputType,
  type EmbeddingsConfig,
  type EmbeddingsStatus,
  type EmbedOptions,
  cosineSimilarity,
  DEFAULT_EMBEDDING_MODEL,
  embed,
  EMBEDDING_DIM,
  EmbeddingError,
  embeddingsStatus,
  MAX_BATCH_SIZE,
  MAX_CONCURRENCY,
  packEmbedding,
  unpackEmbedding,
  warmup,
} from './embeddings';

export {
  type AiErrorCode,
  type AiProviderConfig,
  type ChatMessage,
  type ChatProvider,
  type ChatRole,
  type FinishReason,
  type GenerateRequest,
  type GenerationResult,
  type GenerationUsage,
  type ProviderId,
  type StreamChunk,
  AiProviderError,
  createChatProvider,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_TEMPERATURE,
  getChatProvider,
  HARD_MAX_OUTPUT_TOKENS,
  readProviderConfig,
} from './provider';

import { embeddingsStatus, type EmbeddingsStatus } from './embeddings';
import { getChatProvider, type ProviderId } from './provider';

export interface AiStatus {
  /** `true` when at least tiers 1 and 2 can run — which is always. */
  readonly retrievalReady: boolean;
  readonly embeddings: EmbeddingsStatus;
  readonly generation: {
    readonly provider: ProviderId;
    readonly model: string;
    /** `false` means no model is configured; the assistant still works. */
    readonly available: boolean;
  };
}

/**
 * A configuration snapshot for `/api/health` and the admin AI console.
 *
 * Reports configuration only — it never loads the model or calls the endpoint,
 * so it is safe on every monitor poll. Warming the embedding model is an
 * explicit `warmup()` call; probing the endpoint is an explicit generation.
 * Nothing here can page someone at 4 a.m. for a model download.
 */
export function aiStatus(): AiStatus {
  const provider = getChatProvider();
  return {
    retrievalReady: true,
    embeddings: embeddingsStatus(),
    generation: {
      provider: provider.id,
      model: provider.model,
      available: provider.available,
    },
  };
}
