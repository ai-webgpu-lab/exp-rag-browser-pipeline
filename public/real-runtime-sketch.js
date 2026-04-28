// Real RAG (retrieve + answer) runtime integration sketch for exp-rag-browser-pipeline.
//
// Gated by ?mode=real-rag. Default deterministic harness path is untouched.
// `loadRagFromCdn` is parameterized so tests can inject a stub. The adapter
// uses two pipelines: feature-extraction for retrieval, text-generation for
// the answer step.

const DEFAULT_TRANSFORMERS_VERSION = "3.0.0";
const DEFAULT_TRANSFORMERS_CDN = (version) => `https://esm.sh/@huggingface/transformers@${version}`;
const DEFAULT_EMBEDDER_ID = "Xenova/bge-small-en-v1.5";
const DEFAULT_GENERATOR_ID = "Xenova/Phi-3-mini-4k-instruct-q4f16";

export async function loadRagFromCdn({ version = DEFAULT_TRANSFORMERS_VERSION } = {}) {
  const transformers = await import(/* @vite-ignore */ DEFAULT_TRANSFORMERS_CDN(version));
  if (!transformers || typeof transformers.pipeline !== "function") {
    throw new Error("transformers module did not expose pipeline()");
  }
  return { transformers, pipeline: transformers.pipeline, env: transformers.env };
}

function dot(a, b) {
  let total = 0;
  const len = Math.min(a.length, b.length);
  for (let index = 0; index < len; index += 1) total += a[index] * b[index];
  return total;
}

function toArray(maybeTensor) {
  if (!maybeTensor) return [];
  if (Array.isArray(maybeTensor)) return maybeTensor;
  if (maybeTensor.data && typeof maybeTensor.data[Symbol.iterator] === "function") return Array.from(maybeTensor.data);
  if (typeof maybeTensor.tolist === "function") {
    const out = maybeTensor.tolist();
    return Array.isArray(out[0]) ? out[0] : out;
  }
  return [];
}

export function buildRealRagAdapter({
  pipeline,
  env,
  version = DEFAULT_TRANSFORMERS_VERSION,
  embedderId = DEFAULT_EMBEDDER_ID,
  generatorId = DEFAULT_GENERATOR_ID
}) {
  if (typeof pipeline !== "function") {
    throw new Error("buildRealRagAdapter requires a callable pipeline");
  }
  const slug = `${embedderId}-${generatorId}`.replace(/[^A-Za-z0-9]/g, "-").toLowerCase();
  const id = `rag-${slug}-${version.replace(/[^0-9]/g, "")}`;
  let embedder = null;
  let generator = null;

  return {
    id,
    label: `Browser RAG (Transformers.js ${version})`,
    version,
    capabilities: ["prefill", "decode", "retrieve", "answer", "fixed-output-budget"],
    loadType: "async",
    backendHint: "webgpu",
    isReal: true,
    async loadRuntime({ device = "webgpu", embedderDtype = "fp32", generatorDtype = "q4" } = {}) {
      if (env && typeof env === "object") env.allowRemoteModels = true;
      embedder = await pipeline("feature-extraction", embedderId, { device, dtype: embedderDtype });
      generator = await pipeline("text-generation", generatorId, { device, dtype: generatorDtype });
      return { embedder, generator };
    },
    async prefill(_runtime, prompt) {
      const startedAt = performance.now();
      const query = (prompt && prompt.query) || "";
      const docs = (prompt && Array.isArray(prompt.documents)) ? prompt.documents : [];
      const promptTokens = query.trim().split(/\s+/).filter(Boolean).length;
      const prefillMs = performance.now() - startedAt;
      return { promptTokens, prefillMs, query, documents: docs };
    },
    async decode(activeRuntime, prefillResult, outputTokenBudget = 96) {
      const targetEmbedder = (activeRuntime && activeRuntime.embedder) || embedder;
      const targetGenerator = (activeRuntime && activeRuntime.generator) || generator;
      if (!targetEmbedder || !targetGenerator) {
        throw new Error("real rag adapter requires loadRuntime() before decode()");
      }
      const documents = prefillResult.documents || [];
      if (documents.length === 0) {
        throw new Error("rag decode requires at least one document");
      }
      const retrieveStart = performance.now();
      const queryEmbedding = toArray(await targetEmbedder(prefillResult.query, { pooling: "mean", normalize: true }));
      const scored = [];
      for (const doc of documents) {
        const text = doc.text || String(doc);
        const docEmbedding = toArray(await targetEmbedder(text, { pooling: "mean", normalize: true }));
        scored.push({ id: doc.id || null, text, score: dot(queryEmbedding, docEmbedding) });
      }
      scored.sort((left, right) => right.score - left.score);
      const top = scored.slice(0, 3);
      const retrieveMs = performance.now() - retrieveStart;
      const answerStart = performance.now();
      const context = top.map((entry) => `- ${entry.text}`).join("\n");
      const promptText = `Context:\n${context}\n\nQuestion: ${prefillResult.query}\nAnswer:`;
      const output = await targetGenerator(promptText, { max_new_tokens: outputTokenBudget, return_full_text: false });
      const answerMs = performance.now() - answerStart;
      const text = Array.isArray(output) && output[0] && output[0].generated_text
        ? output[0].generated_text
        : "";
      const tokens = text.split(/\s+/).filter(Boolean).length || outputTokenBudget;
      const decodeMs = retrieveMs + answerMs;
      return {
        tokens,
        decodeMs,
        text,
        retrieveMs,
        answerMs,
        topK: top,
        ttftMs: decodeMs / Math.max(tokens, 1),
        decodeTokPerSec: tokens / Math.max(decodeMs / 1000, 0.001)
      };
    }
  };
}

export async function connectRealRag({
  registry = typeof window !== "undefined" ? window.__aiWebGpuLabRuntimeRegistry : null,
  loader = loadRagFromCdn,
  version = DEFAULT_TRANSFORMERS_VERSION,
  embedderId = DEFAULT_EMBEDDER_ID,
  generatorId = DEFAULT_GENERATOR_ID
} = {}) {
  if (!registry) {
    throw new Error("runtime registry not available");
  }
  const { pipeline, env } = await loader({ version });
  if (typeof pipeline !== "function") {
    throw new Error("loaded pipeline is not callable");
  }
  const adapter = buildRealRagAdapter({ pipeline, env, version, embedderId, generatorId });
  registry.register(adapter);
  return { adapter, pipeline, env };
}

if (typeof window !== "undefined" && window.location && typeof window.location.search === "string") {
  const params = new URLSearchParams(window.location.search);
  if (params.get("mode") === "real-rag" && !window.__aiWebGpuLabRealRagBootstrapping) {
    window.__aiWebGpuLabRealRagBootstrapping = true;
    connectRealRag().catch((error) => {
      console.warn(`[real-rag] bootstrap failed: ${error.message}`);
      window.__aiWebGpuLabRealRagBootstrapError = error.message;
    });
  }
}
