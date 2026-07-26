/**
 * Generation — one interface, an OpenAI-compatible implementation, and a
 * `'none'` implementation that is a first-class citizen rather than a fallback.
 *
 * ## Why OpenAI-compatible rather than a vendor SDK
 * The chat-completions wire format is the one thing every small-model host
 * agrees on. Speaking it directly means the same code runs against:
 *
 * | Where | `AI_BASE_URL` | `AI_API_KEY` |
 * |---|---|---|
 * | Ollama on the VPS | `http://127.0.0.1:11434/v1` | not needed |
 * | llama.cpp / vLLM / LM Studio | `http://host:8080/v1` | not needed |
 * | Groq | `https://api.groq.com/openai/v1` | required |
 * | Together / OpenRouter / DeepInfra | their `/v1` | required |
 *
 * Moving between them is a base URL and a model name. No SDK, no adapter, no
 * migration — which is the point: the owner is not locked to a vendor's pricing
 * or availability, and a self-hosted 3B model on a small VPS is a legitimate
 * production configuration rather than a downgrade.
 *
 * ## Why `'none'` matters
 * With no model configured at all, tier 1 (curated answers) and tier 2's
 * retrieval still work — the assistant returns exact human-written answers and
 * cited source links, and refuses everything else. That is a genuinely useful
 * product, and it is the configuration the app boots into. Generation is an
 * *enhancement* to a system that is already correct, never a dependency of it.
 * `available === false` is a state callers branch on, not an error they catch.
 *
 * ## Determinism
 * `temperature` defaults to 0 and the request cap, the output cap and the
 * timeout are all enforced here rather than trusted to the caller. A generative
 * model in this system is a *rephraser of retrieved text*; sampling creativity
 * has no upside and a clear downside.
 */

import { z } from 'zod';

/* ────────────────────────────────────────────────────────────────────────────
 * Hard limits
 * ────────────────────────────────────────────────────────────────────────── */

/** Nothing sampled, ever. A grounded answer has one correct phrasing budget. */
export const DEFAULT_TEMPERATURE = 0;

/** Ceiling no caller can raise. A chat answer that needs more is not an answer. */
export const HARD_MAX_OUTPUT_TOKENS = 1_024;

export const DEFAULT_MAX_OUTPUT_TOKENS = 512;

/** Whole-request budget. A student watching a caret has already left by 30 s. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Second line of defence behind the token cap: a misconfigured or looping
 * server can stream forever, and `max_tokens` is only honoured by a
 * well-behaved one. At this many characters we abort the connection ourselves.
 */
export const MAX_RESPONSE_CHARS = 32_000;

/* ────────────────────────────────────────────────────────────────────────────
 * Errors
 * ────────────────────────────────────────────────────────────────────────── */

export type AiErrorCode =
  /** No model configured (`'none'` provider). Expected, not exceptional. */
  | 'unavailable'
  /** Our own deadline elapsed. */
  | 'timeout'
  /** The caller's `AbortSignal` fired — a closed tab, a `Stop` button. */
  | 'aborted'
  /** 401/403 — a missing or wrong `AI_API_KEY`. */
  | 'unauthorized'
  /** 429, or a provider quota. */
  | 'rate_limited'
  /** Any other non-2xx. */
  | 'http'
  /** DNS, connection refused, TLS — the endpoint is not reachable. */
  | 'network'
  /** 2xx whose body is not a chat completion. */
  | 'malformed_response'
  /** Our own arguments failed validation before anything was sent. */
  | 'invalid_request';

export class AiProviderError extends Error {
  readonly code: AiErrorCode;
  readonly status: number | null;
  /** `true` when the same request could plausibly succeed on a retry. */
  readonly retryable: boolean;

  constructor(
    code: AiErrorCode,
    message: string,
    options: { status?: number | null; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'AiProviderError';
    this.code = code;
    this.status = options.status ?? null;
    this.retryable =
      code === 'timeout' ||
      code === 'network' ||
      code === 'rate_limited' ||
      (code === 'http' && (options.status ?? 0) >= 500);
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Configuration
 * ────────────────────────────────────────────────────────────────────────── */

export const PROVIDER_IDS = ['openai-compatible', 'none'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/**
 * Strict on purpose (§0.6): the schema is fed an object we build ourselves from
 * exactly these keys, so an unknown key means a typo in this file, and a typo
 * that silently does nothing is how a token cap ends up unenforced in
 * production.
 */
const configSchema = z
  .object({
    AI_PROVIDER: z.enum(PROVIDER_IDS).optional(),
    AI_BASE_URL: z.string().url('must be an absolute URL, scheme included').optional(),
    AI_API_KEY: z.string().min(1).optional(),
    AI_MODEL_CHAT: z.string().min(1).optional(),
    AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1).max(HARD_MAX_OUTPUT_TOKENS).optional(),
    AI_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).optional(),
  })
  .strict();

export interface AiProviderConfig {
  readonly id: ProviderId;
  /** Normalised, no trailing slash. `null` for the `'none'` provider. */
  readonly baseUrl: string | null;
  readonly apiKey: string | null;
  readonly model: string;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
}

/** Default when nothing is configured — small, open, and it runs on a laptop. */
export const DEFAULT_CHAT_MODEL = 'qwen2.5:3b-instruct';

type EnvSource = Record<string, string | undefined>;

function pick(source: EnvSource): Record<string, string | undefined> {
  const keys = [
    'AI_PROVIDER',
    'AI_BASE_URL',
    'AI_API_KEY',
    'AI_MODEL_CHAT',
    'AI_MAX_OUTPUT_TOKENS',
    'AI_TIMEOUT_MS',
  ] as const;
  const picked: Record<string, string | undefined> = {};
  for (const key of keys) {
    const value = source[key];
    const trimmed = typeof value === 'string' ? value.trim() : undefined;
    if (trimmed !== undefined && trimmed.length > 0) picked[key] = trimmed;
  }
  return picked;
}

/**
 * Read the provider configuration.
 *
 * Deliberately reads `process.env` directly rather than `@/lib/env`: this
 * module must be constructible from a plain object in a unit test, and the
 * assistant must degrade to `'none'` rather than crash the process when its
 * variables are absent — the opposite of the boot-time hard failure that is
 * right for `DATABASE_URL`.
 *
 * A malformed value is reported, not tolerated: the deployment is telling us it
 * meant to configure a model, and silently answering nothing would hide that.
 */
export function readProviderConfig(source: EnvSource = readEnv()): AiProviderConfig {
  const parsed = configSchema.safeParse(pick(source));
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${String(issue.path[0] ?? '?')} ${issue.message}`)
      .join('; ');
    throw new AiProviderError('invalid_request', `Invalid AI configuration: ${detail}`);
  }

  const values = parsed.data;
  const baseUrl = values.AI_BASE_URL === undefined ? null : stripTrailingSlash(values.AI_BASE_URL);
  // No explicit provider + no base URL is the honest default: not configured.
  const id: ProviderId = values.AI_PROVIDER ?? (baseUrl === null ? 'none' : 'openai-compatible');

  if (id === 'none' || baseUrl === null) {
    return {
      id: 'none',
      baseUrl: null,
      apiKey: null,
      model: values.AI_MODEL_CHAT ?? DEFAULT_CHAT_MODEL,
      maxOutputTokens: values.AI_MAX_OUTPUT_TOKENS ?? DEFAULT_MAX_OUTPUT_TOKENS,
      timeoutMs: values.AI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS,
    };
  }

  return {
    id: 'openai-compatible',
    baseUrl,
    apiKey: values.AI_API_KEY ?? null,
    model: values.AI_MODEL_CHAT ?? DEFAULT_CHAT_MODEL,
    maxOutputTokens: values.AI_MAX_OUTPUT_TOKENS ?? DEFAULT_MAX_OUTPUT_TOKENS,
    timeoutMs: values.AI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS,
  };
}

function readEnv(): EnvSource {
  return typeof process === 'undefined' ? {} : process.env;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, '');
}

/* ────────────────────────────────────────────────────────────────────────────
 * The interface
 * ────────────────────────────────────────────────────────────────────────── */

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  readonly role: ChatRole;
  readonly content: string;
}

export interface GenerateRequest {
  readonly messages: readonly ChatMessage[];
  /** Clamped to {@link HARD_MAX_OUTPUT_TOKENS}. */
  readonly maxOutputTokens?: number;
  /** Defaults to {@link DEFAULT_TEMPERATURE} (0). */
  readonly temperature?: number;
  readonly stop?: readonly string[];
  /** Aborts the HTTP request — an unmounted dock, a `Stop` button. */
  readonly signal?: AbortSignal;
}

const requestSchema = z
  .object({
    messages: z
      .array(
        z
          .object({
            role: z.enum(['system', 'user', 'assistant']),
            content: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
    maxOutputTokens: z.number().int().min(1).optional(),
    temperature: z.number().min(0).max(2).optional(),
    stop: z.array(z.string().min(1)).max(4).optional(),
    signal: z.instanceof(AbortSignal).optional(),
  })
  .strict();

export type FinishReason = 'stop' | 'length' | 'content_filter' | 'unknown';

export interface GenerationUsage {
  /** `null` when the provider does not report usage (some local servers do not). */
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
}

export interface GenerationResult {
  readonly text: string;
  readonly model: string;
  readonly usage: GenerationUsage;
  readonly finishReason: FinishReason;
  readonly latencyMs: number;
}

export type StreamChunk =
  | { readonly type: 'delta'; readonly text: string }
  | { readonly type: 'done'; readonly result: GenerationResult };

export interface ChatProvider {
  readonly id: ProviderId;
  readonly model: string;
  /**
   * `false` for `'none'`. Check it *before* generating: tiers 1 and 2 have work
   * to do either way, and calling into an unavailable provider throws
   * `AiProviderError('unavailable')` by design.
   */
  readonly available: boolean;
  complete(request: GenerateRequest): Promise<GenerationResult>;
  stream(request: GenerateRequest): AsyncIterable<StreamChunk>;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Wire schemas
 *
 * NOT `.strict()`, deliberately, and this is not an exception to §0.6. Strict
 * belongs on input we define; this is a third party's response, and a provider
 * adding a field (`system_fingerprint`, `x_groq`, `prompt_eval_count`…) must
 * never break a student's answer. We validate the fields we read and ignore the
 * rest, which is the actual safety property.
 * ────────────────────────────────────────────────────────────────────────── */

const usageSchema = z
  .object({
    prompt_tokens: z.number().int().nonnegative().optional(),
    completion_tokens: z.number().int().nonnegative().optional(),
  })
  .nullish();

const completionSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullish() }).optional(),
        finish_reason: z.string().nullish(),
      }),
    )
    .min(1),
  usage: usageSchema,
});

const streamEventSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        delta: z.object({ content: z.string().nullish() }).optional(),
        finish_reason: z.string().nullish(),
      }),
    )
    .optional(),
  usage: usageSchema,
});

function toFinishReason(value: string | null | undefined): FinishReason {
  switch (value) {
    case 'stop':
    case 'end_turn':
      return 'stop';
    case 'length':
    case 'max_tokens':
      return 'length';
    case 'content_filter':
      return 'content_filter';
    default:
      return 'unknown';
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * The `'none'` provider
 * ────────────────────────────────────────────────────────────────────────── */

function unavailable(): AiProviderError {
  return new AiProviderError(
    'unavailable',
    'No language model is configured (AI_BASE_URL is unset). Curated answers and ' +
      'grounded retrieval still work; check `provider.available` before generating.',
  );
}

class NoneProvider implements ChatProvider {
  readonly id = 'none' as const;
  readonly available = false;
  readonly model: string;

  constructor(model: string) {
    this.model = model;
  }

  complete(): Promise<GenerationResult> {
    return Promise.reject(unavailable());
  }

  /** An async generator is the contract; this one refuses before yielding. */
  async *stream(): AsyncGenerator<StreamChunk> {
    throw unavailable();
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * The OpenAI-compatible provider
 * ────────────────────────────────────────────────────────────────────────── */

interface Deadline {
  readonly signal: AbortSignal;
  /** Stop the timer and unsubscribe from the caller's signal. Always in a `finally`. */
  readonly release: () => void;
  /** `true` when *our* deadline fired, as opposed to the caller aborting. */
  readonly timedOut: () => boolean;
}

/**
 * Combine our timeout with the caller's signal by hand.
 *
 * `AbortSignal.any` and `AbortSignal.timeout` exist on Node 22 but their lib
 * typings move between TypeScript releases, and a health check that stops
 * compiling on a minor toolchain bump is not worth the four lines this saves.
 * The manual version also lets us distinguish *our* deadline from *their*
 * abort, which is the difference between `timeout` and `aborted` — and between
 * paging someone and not.
 */
function startDeadline(timeoutMs: number, external: AbortSignal | undefined): Deadline {
  const controller = new AbortController();
  let expired = false;

  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
  }, timeoutMs);

  const onExternalAbort = (): void => controller.abort();
  if (external !== undefined) {
    if (external.aborted) controller.abort();
    else external.addEventListener('abort', onExternalAbort, { once: true });
  }

  return {
    signal: controller.signal,
    release: () => {
      clearTimeout(timer);
      external?.removeEventListener('abort', onExternalAbort);
    },
    timedOut: () => expired,
  };
}

class OpenAiCompatibleProvider implements ChatProvider {
  readonly id = 'openai-compatible' as const;
  readonly available = true;
  readonly model: string;

  private readonly endpoint: string;
  private readonly apiKey: string | null;
  private readonly maxOutputTokens: number;
  private readonly timeoutMs: number;

  constructor(config: AiProviderConfig) {
    if (config.baseUrl === null) throw unavailable();
    // The base URL carries the version path (`…/v1`), exactly as every provider
    // documents it. We append the route and nothing else — guessing at `/v1`
    // breaks the hosts that use a different prefix.
    this.endpoint = `${config.baseUrl}/chat/completions`;
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.maxOutputTokens = Math.min(config.maxOutputTokens, HARD_MAX_OUTPUT_TOKENS);
    this.timeoutMs = config.timeoutMs;
  }

  async complete(request: GenerateRequest): Promise<GenerationResult> {
    const started = Date.now();
    const validated = validate(request);
    const deadline = startDeadline(this.timeoutMs, validated.signal);
    try {
      const response = await this.send(validated, false, deadline.signal);
      const payload: unknown = await response.json();
      const parsed = completionSchema.safeParse(payload);
      if (!parsed.success) {
        throw new AiProviderError(
          'malformed_response',
          'The provider returned 2xx with a body that is not a chat completion.',
        );
      }
      const choice = parsed.data.choices[0];
      return {
        text: choice?.message?.content ?? '',
        model: parsed.data.model ?? this.model,
        usage: {
          tokensIn: parsed.data.usage?.prompt_tokens ?? null,
          tokensOut: parsed.data.usage?.completion_tokens ?? null,
        },
        finishReason: toFinishReason(choice?.finish_reason),
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      throw translate(error, deadline, validated.signal);
    } finally {
      deadline.release();
    }
  }

  async *stream(request: GenerateRequest): AsyncGenerator<StreamChunk> {
    const started = Date.now();
    const validated = validate(request);
    const deadline = startDeadline(this.timeoutMs, validated.signal);

    let text = '';
    let model = this.model;
    let finishReason: FinishReason = 'unknown';
    let tokensIn: number | null = null;
    let tokensOut: number | null = null;

    try {
      const response = await this.send(validated, true, deadline.signal);
      if (response.body === null) {
        throw new AiProviderError('malformed_response', 'The streaming response has no body.');
      }

      for await (const event of readServerSentEvents(response.body)) {
        if (event === '[DONE]') break;
        const parsed = parseJson(event);
        if (parsed === undefined) continue;
        const frame = streamEventSchema.safeParse(parsed);
        if (!frame.success) continue;

        if (frame.data.model !== undefined) model = frame.data.model;
        tokensIn = frame.data.usage?.prompt_tokens ?? tokensIn;
        tokensOut = frame.data.usage?.completion_tokens ?? tokensOut;

        const choice = frame.data.choices?.[0];
        if (choice === undefined) continue;
        if (choice.finish_reason !== null && choice.finish_reason !== undefined) {
          finishReason = toFinishReason(choice.finish_reason);
        }
        const delta = choice.delta?.content;
        if (delta === null || delta === undefined || delta.length === 0) continue;

        text += delta;
        if (text.length > MAX_RESPONSE_CHARS) {
          throw new AiProviderError(
            'malformed_response',
            `The provider streamed past ${MAX_RESPONSE_CHARS} characters; connection dropped.`,
          );
        }
        yield { type: 'delta', text: delta };
      }

      yield {
        type: 'done',
        result: {
          text,
          model,
          usage: { tokensIn, tokensOut },
          finishReason,
          latencyMs: Date.now() - started,
        },
      };
    } catch (error) {
      throw translate(error, deadline, validated.signal);
    } finally {
      deadline.release();
    }
  }

  private async send(
    request: GenerateRequest,
    stream: boolean,
    signal: AbortSignal,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: stream ? 'text/event-stream' : 'application/json',
    };
    // Ollama and llama.cpp need no key. Sending an empty bearer to a host that
    // does check would fail in a way that reads like a wrong key.
    if (this.apiKey !== null) headers.Authorization = `Bearer ${this.apiKey}`;

    const body: Record<string, unknown> = {
      model: this.model,
      messages: request.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      temperature: request.temperature ?? DEFAULT_TEMPERATURE,
      max_tokens: Math.min(request.maxOutputTokens ?? this.maxOutputTokens, HARD_MAX_OUTPUT_TOKENS),
      stream,
    };
    if (request.stop !== undefined && request.stop.length > 0) body.stop = [...request.stop];
    // Hosts that support it report usage on the final SSE frame; the ones that
    // do not ignore the field, which is why it can be sent unconditionally.
    if (stream) body.stream_options = { include_usage: true };

    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
        cache: 'no-store',
      });
    } catch (cause) {
      if (isAbort(cause)) throw cause;
      throw new AiProviderError('network', `Cannot reach ${this.endpoint}.`, { cause });
    }

    if (!response.ok) {
      const detail = await readErrorBody(response);
      throw new AiProviderError(codeForStatus(response.status), detail, {
        status: response.status,
      });
    }
    return response;
  }
}

function validate(request: GenerateRequest): GenerateRequest {
  const parsed = requestSchema.safeParse(request);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.')} ${issue.message}`)
      .join('; ');
    throw new AiProviderError('invalid_request', `Invalid generation request: ${detail}`);
  }
  return request;
}

function codeForStatus(status: number): AiErrorCode {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 429) return 'rate_limited';
  return 'http';
}

/** Never surface a provider's raw body: it can echo the prompt back. */
async function readErrorBody(response: Response): Promise<string> {
  let hint = '';
  try {
    const raw = await response.text();
    hint = raw.slice(0, 200).replace(/\s+/gu, ' ').trim();
  } catch {
    hint = '';
  }
  return hint.length > 0
    ? `Provider returned ${response.status}: ${hint}`
    : `Provider returned ${response.status}.`;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/** Turn whatever `fetch` threw into one of our typed errors. */
function translate(error: unknown, deadline: Deadline, external: AbortSignal | undefined): unknown {
  if (error instanceof AiProviderError) return error;
  if (isAbort(error)) {
    if (deadline.timedOut()) {
      return new AiProviderError('timeout', 'The model did not answer within the deadline.', {
        cause: error,
      });
    }
    if (external?.aborted === true) {
      return new AiProviderError('aborted', 'The request was aborted by the caller.', {
        cause: error,
      });
    }
  }
  return new AiProviderError('network', 'The generation request failed.', { cause: error });
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Minimal SSE reader: yields the concatenated `data:` payload of each event.
 *
 * Written by hand rather than pulled from a dependency because the subset that
 * matters is twenty lines, and because every provider bends the format slightly
 * — comment keepalives, `\r\n`, multi-line data, a final event with no trailing
 * blank line. All four are handled below.
 */
async function* readServerSentEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/gu, '\n');

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const payload = dataOf(block);
        if (payload !== null) yield payload;
        boundary = buffer.indexOf('\n\n');
      }
    }
    const trailing = dataOf(buffer);
    if (trailing !== null) yield trailing;
  } finally {
    // Releasing the lock lets the body be cancelled by the abort controller;
    // without it an abandoned stream keeps the socket open until the deadline.
    reader.releaseLock();
  }
}

function dataOf(block: string): string | null {
  const parts: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) continue; // keepalive comment
    if (!line.startsWith('data:')) continue;
    parts.push(line.slice(5).trimStart());
  }
  if (parts.length === 0) return null;
  const joined = parts.join('\n');
  return joined.length === 0 ? null : joined;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Construction
 * ────────────────────────────────────────────────────────────────────────── */

/** Build a provider from an explicit config. The seam every unit test uses. */
export function createChatProvider(config: AiProviderConfig): ChatProvider {
  if (config.id === 'none' || config.baseUrl === null) return new NoneProvider(config.model);
  return new OpenAiCompatibleProvider(config);
}

let cached: ChatProvider | null = null;

/**
 * The process-wide provider, built once from the environment.
 *
 * Never throws for "not configured" — that is the `'none'` provider, and it is
 * a valid deployment. It does throw for a *malformed* configuration, at the
 * first call, because that is a deployment mistake someone must see.
 */
export function getChatProvider(): ChatProvider {
  if (cached === null) cached = createChatProvider(readProviderConfig());
  return cached;
}

/** Test seam: forget the cached provider so the next call re-reads the env. */
export function resetChatProviderForTests(): void {
  cached = null;
}
