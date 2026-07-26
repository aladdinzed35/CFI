# Nour — the CFI assistant

> **The one rule.** Nour answers **exactly**, answers **with a citation**, or
> **refuses**. There is no fourth branch. A confident wrong answer about a price
> or a bank transfer costs this business a customer and a refund; "je ne trouve
> pas cette information" costs it nothing.

This document covers the foundation that is built today: local embeddings, the
generation provider, and the answer policy. Retrieval, the chat route, the dock
UI and the ingestion job are M7 and are specified in §16 of the project spec.

**Code:** `src/server/ai/` — `answer-policy.ts` (pure tier logic),
`embeddings.ts` (local ONNX), `provider.ts` (generation), `index.ts` (barrel).

---

## 1. How it works

A question goes through three tiers, in order. The first one that can answer,
answers.

### Tier 1 — curated (deterministic, exact, instant)

An admin-approved `CuratedAnswer` matched by **normalised text** or by
retrieval above a high floor is returned **verbatim**, with its source. No model
is involved at any point, so there is no step at which the wording can be
distorted, softened, or invented.

This is the 100 %-accurate path, and it is designed to be the **majority** path.
At a training centre, most real questions are the same twenty questions:

- Combien coûte la formation ?
- Quand commence la prochaine session ?
- Quel est le RIB pour le virement ?
- Combien de temps prend la vérification du virement ?
- Comment m'inscrire ? Que contient la formation ? Y a-t-il un certificat ?

Every one of those belongs in tier 1. Seeding the curated table with them — and
letting the §16.6 feedback loop keep adding to it — is what turns "the assistant
is usually right" into "the assistant is exactly right about the things that
matter commercially".

Matching is done on a folded form of the question (`normaliseQuestion`): case,
accents, punctuation, Arabic tashkeel, tatweel, alef/ya/ta-marbuta variants and
Arabic-Indic digits are all normalised away, so « Quel est le PRIX ? » and
« quel est le prix » are one key, and so are « ما هو السِّعر ؟ » and « ما هو
السعر ». An exact fold match wins **regardless of its retrieval score** — a
human wrote that pair for that question and no similarity metric has standing to
disagree.

A curated pair that is merely *close* (below `CURATED_FLOOR`) is **not** served
verbatim. It falls through to tier 2, where the model must ground its answer in
it and cite it. Serving a near-miss verbatim is how you answer the price of the
wrong course with total confidence.

Tier 1 also refuses to serve an answer in a locale the student did not ask in. A
correct answer in the wrong language is a wrong answer.

### Tier 2 — grounded retrieval

Retrieval (M7) returns candidate chunks from CFI's own content only —
course descriptions, lesson bodies, transcripts, extracted resource text, FAQ,
public pages, approved curated answers — already entitlement-filtered **in SQL**
(§16.3: a paid transcript must be physically impossible to retrieve for a
non-enrolled user; that filter is in the query, never in this policy module).

`classify()` keeps what clears `GROUNDING_FLOOR`, best first, up to
`MAX_GROUNDED_CHUNKS` (6) and `MAX_GROUNDED_CHARS` (8 000 ≈ 3 000 tokens). The
model is then asked to answer **only** from those chunks and to cite them.

The citation requirement is not a hope, it is enforced. `verifyCitations()` /
`enforceGrounding()` check the answer's citations against the chunks that were
actually given to it, and reject two things:

| Failure | What it means | What happens |
|---|---|---|
| **No citation** | the model wrote from its own weights, not from the context | answer discarded → refusal |
| **Unknown citation** | the model invented a source | answer discarded → refusal |

A model that ignores its instructions therefore produces **silence**, not a
plausible fabrication. That is the structural part of "correctness rather than
hope": the guarantee does not depend on the model behaving.

Chunks kept after verification are narrowed to the ones actually cited, so the
citation chips a student sees are the sources the answer really used.

### Tier 3 — refuse

Below the floor, or after a failed verification, Nour says plainly that the
answer is not in the course material and offers the WhatsApp hand-off. It never
speculates. Refusals are typed (`RefusalReason`), not prose — the UI translates
them — and they carry the best score seen, which feeds the `À revoir` queue and
the gap clustering in §16.6. **Every refusal is a content-roadmap entry**, which
is what makes refusing cheap and improving automatic.

---

## 2. What each tier costs

| Tier | Work | Latency | Money |
|---|---|---|---|
| 1 · curated | one indexed SQL lookup + a string fold | ~1–5 ms | **zero** |
| 2 · grounded | 1 embedding (CPU) + FULLTEXT + in-memory cosine, then generation | ~20–40 ms retrieval, plus the model | embedding **zero**; generation only |
| 3 · refuse | same as tier 2 minus generation | ~20–40 ms | **zero** |

Embeddings are local, so indexing the whole catalogue and every student question
costs nothing but CPU. The **only** variable cost in the system is tier-2
generation, and with a self-hosted model on the VPS that is zero too.

---

## 3. Embeddings — `src/server/ai/embeddings.ts`

### The model

**`Xenova/multilingual-e5-small`**, int8-quantised ONNX, run in-process by
`@huggingface/transformers` (transformers.js v3).

| Property | Value |
|---|---|
| Dimensions | **384** (`EMBEDDING_DIM`) |
| Layers / context | 12 / 512 tokens |
| Vocabulary | XLM-RoBERTa, 250 037 tokens, 100 languages |
| Quantised weights | `onnx/model_quantized.onnx` — **118 MB** |
| Tokenizer | 17 MB (`tokenizer.json`) |
| **On disk, total** | **≈ 135 MB** |
| Resident memory | ≈ 150–200 MB once loaded |
| Speed | a few milliseconds per short text on one CPU core |

**Why this one.** The requirement is fr/ar/en/es in a single vector space, on a
small shared VPS, with no API key. That rules out the fast English-only models
(`all-MiniLM-L6-v2`, `bge-small-en`) however tempting their size — Arabic is a
first-class locale here, not a nice-to-have. Among genuinely multilingual small
models, E5-small is trained specifically for **asymmetric retrieval** (short
question ↔ long passage), which is exactly this workload, and it beats
`paraphrase-multilingual-MiniLM-L12-v2` (the model spec §16.2 suggested as the
local fallback) on retrieval benchmarks at the same size and dimension. 384
dimensions is also a quarter of Voyage's 1 024, so the stored corpus and the
in-memory cosine pass are four times cheaper.

**The prefixes matter.** E5 requires `query: ` before a question and `passage: `
before content. Using the wrong one degrades recall by several points with **no
error anywhere**, so it is centralised in `embed()` behind `inputType` and never
written at a call site. Content is embedded as `document`, a student's question
as `query`. If you ever re-index with the wrong prefix, the corpus is silently
wrong — this is the single easiest way to break retrieval quality.

```ts
import { embed } from '@/server/ai';

const vectors = await embed(chunks.map((c) => c.content));       // documents
const [queryVector] = await embed([question], { inputType: 'query' });
```

Vectors come out L2-normalised, so cosine similarity is a dot product.
`packEmbedding` / `unpackEmbedding` convert to and from the little-endian
Float32 buffer stored in `KnowledgeChunk.embedding` (explicitly little-endian:
`Float32Array` follows host byte order, and a corpus written on one endianness
and read on another would produce meaningless similarities rather than an
error).

### Resource discipline

CFI runs as **one** shared Node process (§2 C1). ONNX inference is CPU-bound and
synchronous, so two concurrent embed calls compete for the same cores and stall
request handling.

- `MAX_CONCURRENCY = 1` — every call goes through a strict serial queue. This is
  not a tunable.
- `MAX_BATCH_SIZE = 16` — a re-index does one forward pass per 16 chunks.
- The model is loaded **lazily** on first use and cached for the process
  lifetime. A failed load is not cached, so a transient failure is retryable.
- `warmup()` pays the ~2 s load once, off the critical path. Call it from
  `/api/health` or a boot hook so the first student's question does not.

### Installing it

`@huggingface/transformers` is an **optional** dependency: a checkout that never
touches the assistant should not download 100 MB of ONNX Runtime, and
`src/server/ai/embeddings.ts` type-checks and runs without it (it throws a typed
`EmbeddingError('load_failed')` with installation instructions).

```bash
npm i @huggingface/transformers
```

Also add it to `serverExternalPackages` in `next.config.ts` so Next never tries
to trace a native module into the server bundle:

```ts
// next.config.ts
serverExternalPackages: ['@huggingface/transformers'],
```

Weights are downloaded from the Hugging Face CDN **on first load** and cached on
disk (`node_modules/@huggingface/transformers/.cache` by default, or
`HF_HOME`). On Hostinger, warm the cache once during deployment — do not let the
first production request trigger a 135 MB download.

---

## 4. Generation — `src/server/ai/provider.ts`

One interface, `ChatProvider`, with two implementations.

### `'openai-compatible'`

The chat-completions wire format is the one thing every small-model host agrees
on. Speaking it directly means the same code runs anywhere by changing a base
URL — no SDK, no adapter, no migration, no vendor lock.

Guarantees enforced **here**, not left to callers:

- `temperature` defaults to **0**. The model is a rephraser of retrieved text;
  sampling creativity has no upside and an obvious downside.
- `max_tokens` is clamped to `HARD_MAX_OUTPUT_TOKENS` (1 024) whatever the
  caller asks for.
- A whole-request **abort deadline** (`AI_TIMEOUT_MS`, default 30 s), kept
  distinct from a caller abort — `timeout` and `aborted` are different errors,
  and only one of them is worth paging someone about.
- A **runaway-stream guard**: `max_tokens` is only honoured by a well-behaved
  server, so past `MAX_RESPONSE_CHARS` (32 000) we drop the connection
  ourselves.
- Typed errors only: `AiProviderError` with a `code` of `unavailable`,
  `timeout`, `aborted`, `unauthorized`, `rate_limited`, `http`, `network`,
  `malformed_response` or `invalid_request`, plus a `retryable` flag.
- Streaming over SSE, parsed by hand (twenty lines; handles comment keepalives,
  `\r\n`, multi-line `data:`, and a final event with no trailing blank line).

Provider responses are validated but **not** `.strict()` — a provider adding a
field must never break a student's answer. Our own inputs (config, request) are
strict.

### `'none'` — a first-class configuration

With no model configured, `provider.available === false` and tiers 1 and 2's
retrieval still work: exact curated answers, and cited source links for
everything else. That is a genuinely useful product, and it is what the app
boots into.

**Generation is an enhancement to a system that is already correct, never a
dependency of it.** Check `provider.available` before generating; calling an
unavailable provider throws `AiProviderError('unavailable')` by design.

```ts
import { getChatProvider, classify, enforceGrounding } from '@/server/ai';

const decision = classify(question, candidates, { locale });
switch (decision.kind) {
  case 'curated':
    return send(decision.answer, decision.source);          // no model at all
  case 'grounded': {
    const provider = getChatProvider();
    if (!provider.available) return sendSources(decision.chunks);   // still useful
    const answer = await provider.complete({ messages });
    return enforceGrounding(decision, citationsFrom(answer));
  }
  case 'refuse':
    return sendRefusal(decision.reason);                    // + WhatsApp CTA
}
```

---

## 5. Running a model locally with Ollama

On the VPS (or your laptop):

```bash
# 1. install
curl -fsSL https://ollama.com/install.sh | sh

# 2. pull a small open model
ollama pull qwen2.5:3b-instruct     # ~2 GB RAM at q4_K_M

# 3. check it answers
ollama run qwen2.5:3b-instruct "Réponds en une phrase : qu'est-ce qu'un virement bancaire ?"

# 4. point CFI at it
#    .env
AI_BASE_URL=http://127.0.0.1:11434/v1
AI_MODEL_CHAT=qwen2.5:3b-instruct
# AI_API_KEY is not needed — Ollama does not authenticate
```

Ollama serves the OpenAI-compatible API on `/v1` and needs no key. Keep it bound
to `127.0.0.1` and never expose the port publicly.

### Which model

| Model | RAM (q4) | Notes |
|---|---|---|
| **`qwen2.5:3b-instruct`** | ~2 GB | **The default.** Best multilingual quality per byte at this size; handles fr/es/en well, ar acceptably. |
| `qwen2.5:7b-instruct` | ~5 GB | Noticeably better Arabic and better instruction-following. Use it if the VPS has ≥ 8 GB. |
| `gemma2:2b`, `llama3.2:3b` | ~2 GB | Faster, but weak in Arabic. Only for an fr/en-only deployment. |

**Be honest about Arabic at 3B.** A 3-billion-parameter model writes serviceable
but unpolished Arabic. This is exactly why tier 1 exists: Arabic-speaking
prospects asking about price, transfers and enrolment should be hitting curated
answers written by a human, not generated prose. Curate the Arabic FAQ well and
the model's Arabic weakness stops being a customer-facing problem.

Expect roughly 15–40 tokens/second for a 3B model on a shared vCPU — usable with
streaming, sluggish without. Stream.

---

## 6. Pointing at a hosted endpoint

Same code, different environment. Any OpenAI-compatible host works; these are
the ones worth considering, and you should check each provider's current model
list rather than trusting a model id written down here.

```dotenv
# Groq — fastest inference available, generous free tier
AI_BASE_URL=https://api.groq.com/openai/v1
AI_API_KEY=gsk_...
AI_MODEL_CHAT=llama-3.3-70b-versatile

# Together / DeepInfra / OpenRouter — pay per token, huge model choice
AI_BASE_URL=https://api.together.xyz/v1
AI_API_KEY=...
AI_MODEL_CHAT=Qwen/Qwen2.5-7B-Instruct-Turbo
```

`AI_BASE_URL` must include the version path exactly as the provider documents
it (`…/v1`, `…/openai/v1`). We append `/chat/completions` and nothing else —
guessing at a prefix breaks the hosts that use a different one.

A hosted endpoint buys quality and speed at the price of a key to rotate, a rate
limit, and an availability dependency. It changes nothing about correctness:
tiers 1 and 3 do not involve the model, and tier 2's citation enforcement
applies identically.

---

## 7. Environment variables

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `AI_BASE_URL` | no | — | OpenAI-compatible endpoint, version path included. **Absent ⇒ `'none'` provider.** |
| `AI_API_KEY` | no | — | Omit for Ollama / llama.cpp / vLLM. |
| `AI_MODEL_CHAT` | no | `qwen2.5:3b-instruct` | Model id as the endpoint names it. |
| `AI_PROVIDER` | no | inferred | `openai-compatible` \| `none`. Force `none` to disable generation while keeping tiers 1–2. |
| `AI_MAX_OUTPUT_TOKENS` | no | `512` | Clamped to 1 024. |
| `AI_TIMEOUT_MS` | no | `30000` | Whole-request deadline, 1 000–120 000. |
| `AI_EMBEDDING_MODEL` | no | `Xenova/multilingual-e5-small` | Changing it invalidates every stored vector. |
| `AI_EMBEDDING_DTYPE` | no | `q8` | `fp32` if a measurement ever justifies the size. |

Every one is optional **by design**: a deployment with none of them set boots
into a working, useful, honest assistant. Nothing here belongs in the
crash-on-boot category — an absent model is a product state, not a
misconfiguration. A *malformed* value does throw, at first use, because that is
a deployment mistake someone must see.

These are read from `process.env` directly rather than through `src/lib/env.ts`
so the module is constructible from a plain object in a unit test and so a
missing value degrades instead of killing the process.

**Retired by this design:** `ANTHROPIC_API_KEY`, `AI_MODEL_REASONING`,
`EMBEDDINGS_PROVIDER`, `VOYAGE_API_KEY`.

---

## 8. Calibrating the floors

All thresholds are named constants in `answer-policy.ts`, with the reasoning in
comments next to them.

Scores reaching `classify()` are **normalised relevance in [0, 1]**, not raw
cosines. This matters: E5-family models compress their similarity range badly —
two *unrelated* multilingual sentences typically sit around **0.70–0.78** cosine
and genuinely relevant pairs above ~0.82. A floor written as a raw cosine would
mean something entirely different from what it reads like, and would change
meaning the day the model changes.

`rescaleCosine()` maps the usable band onto [0, 1] using `COSINE_NOISE_FLOOR`
(0.70), so the floors below read as plain relevance percentages:

| Constant | Value | Raw cosine equivalent | Role |
|---|---|---|---|
| `CURATED_FLOOR` | 0.60 | ≈ 0.88 | serve a curated answer **verbatim** |
| `GROUNDING_FLOOR` | 0.28 | ≈ 0.78 | admit a chunk as grounding (spec §16.3's starting value) |
| `MIN_CITATIONS` | 1 | — | citations required per grounded answer |
| `MAX_GROUNDED_CHUNKS` | 6 | — | chunks in context |
| `MAX_GROUNDED_CHARS` | 8 000 | — | ≈ 3 000 tokens of context |

**To recalibrate** (do this once there is a real corpus, and again whenever the
embedding model changes):

1. Build an evaluation set of 100–200 real questions with the chunk that should
   answer each, plus 50 questions that are genuinely out of scope.
2. Embed and score them; measure the *unrelated* pair distribution and set
   `COSINE_NOISE_FLOOR` at its upper edge.
3. Sweep `GROUNDING_FLOOR`. Optimise for **near-zero wrong answers**, not for
   maximum coverage — the out-of-scope questions must all refuse.
4. Raising the floor trades recall for a higher refusal rate. That is the safe
   direction to err in, always.

---

## 9. What "100 % accuracy" does and does not mean

The owner's requirement is *"contextual based only on the app and its data, fast
replies, 100 % precision and accuracy."* Here is the honest reading, because
this section is the one that prevents a disappointment later.

**No generative model is 100 % accurate.** Not this one, not the largest and
most expensive one available, not with any prompt. A language model produces
plausible text; plausibility and truth coincide most of the time and diverge
without warning. Anyone claiming otherwise is selling something. Fine-tuning
does not fix it either — it makes a model *sound* more like you while making its
knowledge harder to update and impossible to audit.

**What this architecture actually guarantees:**

1. **Tier 1 is exact, by construction.** The stored text is returned byte for
   byte. No model is involved, so there is nothing that could distort it. If a
   curated answer is right, the reply is right — permanently, auditably, and in
   the exact wording the centre approved. This is a real 100 %, and it is why
   the curated table should be seeded aggressively.
2. **Nothing is ever asserted without a source.** A tier-2 answer that cites
   nothing, or cites something it was not given, is discarded and becomes a
   refusal. Enforcement is code, not prompt wording.
3. **Knowledge is CFI's own content only.** The corpus is the catalogue, the
   lessons, the transcripts, the FAQ and the approved answers. There is no
   general-knowledge browsing and no other source.
4. **Silence over speculation.** Below the floor, Nour refuses and offers a
   human. Refusing is not a failure state — it is the correct output, and the
   cheap one.
5. **Instantly correctable.** A wrong answer is fixed by editing content or
   approving a curated answer, and is correct on the next question. No
   retraining, no waiting, no vendor.
6. **Auditable.** Every answer records what was retrieved and what was cited
   (`AiMessage.retrievedIds`, `citations`), so "why did it say that?" always has
   an answer.

**What it does not guarantee:** that a tier-2 answer's *phrasing* is always
ideal; that the right chunk is always retrieved (a question phrased very
unusually may refuse when the material does exist); that a small model's Arabic
prose is elegant. The first is cosmetic, the second is measurable and shows up
in the gap backlog as a content-roadmap entry, and the third is what tier 1 is
for.

**The honest one-line summary, and the one to use with the owner:** *Nour is
100 % accurate on everything a human has approved, always sourced on everything
else, and silent rather than wrong when it does not know.* That is a stronger
commercial promise than "a very smart chatbot", and unlike that one, it is true.

---

## 10. Not built yet (M7)

Retrieval (hybrid FULLTEXT + vector fusion, entitlement pre-filtering), the
ingestion/chunking job, the SSE chat route, the dock UI, per-student memory, the
feedback and gap loops, and the admin AI console. This module is their
foundation and it is complete and testable on its own; see spec §16 for the
rest.

---

## Measured retrieval behaviour, and the two rules that follow from it

Run against the real model (`Xenova/multilingual-e5-small`, q8) on 2026-07-27, with
five short French passages as the corpus. Not estimates — these are the numbers the
model produced.

| Query | Top hit | Rescaled | Runner-up | Margin |
|---|---|---|---|---|
| « Comment payer ma formation ? » (fr) | payment ✅ | 0.599 | certificate 0.388 | **0.211** |
| « كيف أؤدي ثمن الدورة التدريبية؟ » (ar) | payment ✅ | 0.244 | certificate 0.165 | **0.079** |
| "Do I get a certificate at the end?" (en) | payment ❌ | 0.463 | certificate 0.445 | **0.018** |

Latency: **8 ms** for a warm single-query embedding. First call pays a one-off model
download and load (~75 s on a cold cache); `warmup()` exists so that cost is paid at
boot rather than by the first student to ask a question.

### Rule 1 — index every locale separately

The English row above is a **wrong answer delivered confidently**: a question about
certificates matched the bank-transfer passage. Cross-lingual matching — query in one
language, corpus in another — is where a small multilingual model is weakest, and the
gap collapses to noise.

The fix is not a bigger model. It is to stop asking for cross-lingual matching at all:
`KnowledgeChunk` rows carry a `locale`, every course and lesson is already translated
into all four, so **M7 must embed each locale's text as its own chunk and filter
retrieval to the reader's locale**, falling back to French only when that locale has no
chunks at all. Same-language retrieval is where the French row's healthy 0.211 margin
comes from.

### Rule 2 — an absolute floor is not enough

Both English candidates cleared `GROUNDING_FLOOR` (0.28) comfortably. A floor-only
policy would have answered. `DISAMBIGUATION_MARGIN` (0.06) exists because of this exact
measurement: when the best chunk fails to beat the best chunk from a *different subject*
by that margin, retrieval has not identified a subject, and the honest answer is a
refusal plus the WhatsApp hand-off.

Chunks from the same lesson are exempt — agreement within one source is corroboration,
not ambiguity. `tests/unit/answer-policy.test.ts` pins all of this, including the exact
0.463 / 0.445 pair, so the guard cannot be tuned away without a failing test.

### What this costs

Refusing on ambiguity means the assistant sometimes says "I don't know" to a question it
could have half-answered. That is the intended trade. For a training centre, a confident
wrong answer about a price, a bank transfer or a certificate is worse than a hand-off to
a human — and the hand-off already exists on every page.
