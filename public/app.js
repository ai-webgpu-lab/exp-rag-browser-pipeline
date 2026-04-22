const state = {
  startedAt: performance.now(),
  environment: buildEnvironment(),
  fixture: null,
  active: false,
  run: null,
  logs: []
};

const elements = {
  statusRow: document.getElementById("status-row"),
  summary: document.getElementById("summary"),
  runPipeline: document.getElementById("run-pipeline"),
  downloadJson: document.getElementById("download-json"),
  metricGrid: document.getElementById("metric-grid"),
  metaGrid: document.getElementById("meta-grid"),
  logList: document.getElementById("log-list"),
  resultJson: document.getElementById("result-json")
};

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

function parseBrowser() {
  const ua = navigator.userAgent;
  for (const [needle, name] of [["Edg/", "Edge"], ["Chrome/", "Chrome"], ["Firefox/", "Firefox"], ["Version/", "Safari"]]) {
    const marker = ua.indexOf(needle);
    if (marker >= 0) return { name, version: ua.slice(marker + needle.length).split(/[\s)/;]/)[0] || "unknown" };
  }
  return { name: "Unknown", version: "unknown" };
}

function parseOs() {
  const ua = navigator.userAgent;
  if (/Windows NT/i.test(ua)) {
    const match = ua.match(/Windows NT ([0-9.]+)/i);
    return { name: "Windows", version: match ? match[1] : "unknown" };
  }
  if (/Mac OS X/i.test(ua)) {
    const match = ua.match(/Mac OS X ([0-9_]+)/i);
    return { name: "macOS", version: match ? match[1].replace(/_/g, ".") : "unknown" };
  }
  if (/Android/i.test(ua)) {
    const match = ua.match(/Android ([0-9.]+)/i);
    return { name: "Android", version: match ? match[1] : "unknown" };
  }
  if (/(iPhone|iPad|CPU OS)/i.test(ua)) {
    const match = ua.match(/OS ([0-9_]+)/i);
    return { name: "iOS", version: match ? match[1].replace(/_/g, ".") : "unknown" };
  }
  if (/Linux/i.test(ua)) return { name: "Linux", version: "unknown" };
  return { name: "Unknown", version: "unknown" };
}

function inferDeviceClass() {
  const threads = navigator.hardwareConcurrency || 0;
  const memory = navigator.deviceMemory || 0;
  const mobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  if (mobile) return memory >= 6 && threads >= 8 ? "mobile-high" : "mobile-mid";
  if (memory >= 16 && threads >= 12) return "desktop-high";
  if (memory >= 8 && threads >= 8) return "desktop-mid";
  if (threads >= 4) return "laptop";
  return "unknown";
}

function buildEnvironment() {
  return {
    browser: parseBrowser(),
    os: parseOs(),
    device: {
      name: navigator.platform || "unknown",
      class: inferDeviceClass(),
      cpu: navigator.hardwareConcurrency ? `${navigator.hardwareConcurrency} threads` : "unknown",
      memory_gb: navigator.deviceMemory || undefined,
      power_mode: "unknown"
    },
    gpu: { adapter: "not-applicable", required_features: [], limits: {} },
    backend: "mixed",
    fallback_triggered: false,
    worker_mode: "main",
    cache_state: "cold"
  };
}

function vectorizeText(text, dimension = 64) {
  const vector = new Float32Array(dimension);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    const slot = (code + index * 13) % dimension;
    vector[slot] += (code % 31) / 31;
    vector[(slot * 5 + 7) % dimension] += ((code % 11) + 1) / 13;
  }
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  return Array.from(vector, (value) => value / norm);
}

function cosineSimilarity(left, right) {
  let dot = 0;
  for (let index = 0; index < left.length; index += 1) dot += left[index] * right[index];
  return dot;
}

function log(message) {
  state.logs.unshift(`[${new Date().toLocaleTimeString()}] ${message}`);
  state.logs = state.logs.slice(0, 12);
  renderLogs();
}

async function loadFixture() {
  if (state.fixture) return state.fixture;
  const response = await fetch("./rag-fixture.json", { cache: "no-store" });
  state.fixture = await response.json();
  return state.fixture;
}

function chunkDocument(document) {
  return document.text
    .split(". ")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((text, index) => ({
      id: `${document.id}-chunk-${index + 1}`,
      documentId: document.id,
      text: text.endsWith(".") ? text : `${text}.`
    }));
}

async function runPipeline() {
  if (state.active) return;
  state.active = true;
  render();
  const fixture = await loadFixture();
  log("RAG pipeline: ingesting bundled documents.");

  const ingestStartedAt = performance.now();
  const allChunks = fixture.documents.flatMap((document) => chunkDocument(document));
  const ingestMsPerPage = (performance.now() - ingestStartedAt) / fixture.documents.length;

  const embedStartedAt = performance.now();
  const embeddedChunks = allChunks.map((chunk) => ({
    ...chunk,
    vector: vectorizeText(chunk.text)
  }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const embedTotalMs = performance.now() - embedStartedAt;

  let retrieveTotalMs = 0;
  let rerankTotalMs = 0;
  let answerTtftTotalMs = 0;
  let answerTotalMs = 0;
  let citationHits = 0;

  for (const question of fixture.questions) {
    const questionVector = vectorizeText(question.query);
    const retrieveStartedAt = performance.now();
    const retrieved = embeddedChunks
      .map((chunk) => ({ ...chunk, score: cosineSimilarity(questionVector, chunk.vector) }))
      .sort((left, right) => right.score - left.score)
      .slice(0, 4);
    retrieveTotalMs += performance.now() - retrieveStartedAt;

    const rerankStartedAt = performance.now();
    const reranked = retrieved
      .map((chunk) => ({
        ...chunk,
        rerankScore: chunk.score + (question.query.toLowerCase().split(" ").some((token) => chunk.text.toLowerCase().includes(token)) ? 0.04 : 0)
      }))
      .sort((left, right) => right.rerankScore - left.rerankScore);
    rerankTotalMs += performance.now() - rerankStartedAt;

    const answerStartedAt = performance.now();
    await new Promise((resolve) => setTimeout(resolve, 18));
    answerTtftTotalMs += performance.now() - answerStartedAt;
    const answer = reranked.slice(0, 2).map((chunk) => chunk.text).join(" ");
    await new Promise((resolve) => setTimeout(resolve, 12));
    answerTotalMs += performance.now() - answerStartedAt;

    if (reranked.some((chunk) => chunk.documentId === question.expectedDocumentId)) citationHits += 1;
    log(`Answered "${question.query}" with citation ${reranked[0].documentId}.`);
    question.answer = answer;
  }

  state.run = {
    documents: fixture.documents.length,
    chunkCount: allChunks.length,
    questionCount: fixture.questions.length,
    ingestMsPerPage,
    embedTotalMs,
    retrieveMs: retrieveTotalMs / fixture.questions.length,
    rerankMs: rerankTotalMs / fixture.questions.length,
    answerTtftMs: answerTtftTotalMs / fixture.questions.length,
    answerTotalMs: answerTotalMs / fixture.questions.length,
    citationHitRate: citationHits / fixture.questions.length
  };
  state.active = false;
  log(`RAG pipeline complete: chunks=${state.run.chunkCount}, citationHitRate=${round(state.run.citationHitRate, 2)}.`);
  render();
}

function buildResult() {
  const run = state.run;
  return {
    meta: {
      repo: "exp-rag-browser-pipeline",
      commit: "bootstrap-generated",
      timestamp: new Date().toISOString(),
      owner: "ai-webgpu-lab",
      track: "ml",
      scenario: run ? "browser-rag-fixture" : "browser-rag-pending",
      notes: run
        ? `deterministic fixture; docs=${run.documents}; chunks=${run.chunkCount}; questions=${run.questionCount}`
        : "Run the deterministic browser RAG fixture."
    },
    environment: state.environment,
    workload: {
      kind: "rag",
      name: "browser-rag-fixture",
      input_profile: state.fixture ? `${state.fixture.documents.length}-docs-${state.fixture.questions.length}-questions` : "fixture-pending",
      dataset: "rag-fixture-v1"
    },
    metrics: {
      common: {
        time_to_interactive_ms: round(performance.now() - state.startedAt, 2) || 0,
        init_ms: run ? round(run.embedTotalMs, 2) || 0 : 0,
        success_rate: run ? 1 : 0.5,
        peak_memory_note: navigator.deviceMemory ? `${navigator.deviceMemory} GB reported by browser` : "deviceMemory unavailable",
        error_type: ""
      },
      rag: {
        ingest_ms_per_page: run ? round(run.ingestMsPerPage, 2) || 0 : 0,
        chunk_count: run ? run.chunkCount : 0,
        embed_total_ms: run ? round(run.embedTotalMs, 2) || 0 : 0,
        retrieve_ms: run ? round(run.retrieveMs, 2) || 0 : 0,
        rerank_ms: run ? round(run.rerankMs, 2) || 0 : 0,
        answer_ttft_ms: run ? round(run.answerTtftMs, 2) || 0 : 0,
        answer_total_ms: run ? round(run.answerTotalMs, 2) || 0 : 0,
        citation_hit_rate: run ? round(run.citationHitRate, 2) || 0 : 0
      }
    },
    status: run ? "success" : "partial",
    artifacts: {
      raw_logs: state.logs.slice(0, 5),
      deploy_url: "https://ai-webgpu-lab.github.io/exp-rag-browser-pipeline/"
    }
  };
}

function renderStatus() {
  const badges = state.active
    ? ["Pipeline running", "Fixture active"]
    : state.run
      ? ["Pipeline complete", `Hit rate ${round(state.run.citationHitRate, 2)}`]
      : ["Fixture ready", "Awaiting run"];
  elements.statusRow.innerHTML = "";
  for (const text of badges) {
    const node = document.createElement("span");
    node.className = "badge";
    node.textContent = text;
    elements.statusRow.appendChild(node);
  }
  elements.summary.textContent = state.run
    ? `Last run: ${state.run.documents} docs, ${state.run.chunkCount} chunks, citation hit-rate ${round(state.run.citationHitRate, 2)}.`
    : "Run the full pipeline to ingest bundled documents, generate deterministic embeddings, and answer the bundled question set with citations.";
}

function renderMetrics() {
  const run = state.run;
  const cards = [
    ["Docs", run ? String(run.documents) : "pending"],
    ["Chunks", run ? String(run.chunkCount) : "pending"],
    ["Ingest/Page", run ? `${round(run.ingestMsPerPage, 2)} ms` : "pending"],
    ["Embed Total", run ? `${round(run.embedTotalMs, 2)} ms` : "pending"],
    ["Retrieve", run ? `${round(run.retrieveMs, 2)} ms` : "pending"],
    ["Citation Hit", run ? `${round(run.citationHitRate, 2)}` : "pending"]
  ];
  elements.metricGrid.innerHTML = "";
  for (const [label, value] of cards) {
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `<span class="label">${label}</span><div class="value">${value}</div>`;
    elements.metricGrid.appendChild(card);
  }
}

function renderEnvironment() {
  const info = [
    ["Browser", `${state.environment.browser.name} ${state.environment.browser.version}`],
    ["OS", `${state.environment.os.name} ${state.environment.os.version}`],
    ["Device", state.environment.device.class],
    ["CPU", state.environment.device.cpu],
    ["Memory", state.environment.device.memory_gb ? `${state.environment.device.memory_gb} GB` : "unknown"],
    ["Backend", state.environment.backend],
    ["Cache State", state.environment.cache_state]
  ];
  elements.metaGrid.innerHTML = "";
  for (const [label, value] of info) {
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `<span class="label">${label}</span><div class="value">${value}</div>`;
    elements.metaGrid.appendChild(card);
  }
}

function renderLogs() {
  elements.logList.innerHTML = "";
  const entries = state.logs.length ? state.logs : ["No RAG activity yet."];
  for (const entry of entries) {
    const li = document.createElement("li");
    li.textContent = entry;
    elements.logList.appendChild(li);
  }
}

function render() {
  renderStatus();
  renderMetrics();
  renderEnvironment();
  renderLogs();
  elements.resultJson.textContent = JSON.stringify(buildResult(), null, 2);
}

function downloadJson() {
  const blob = new Blob([JSON.stringify(buildResult(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `exp-rag-browser-pipeline-${state.run ? "fixture" : "pending"}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  log("Downloaded RAG pipeline JSON draft.");
}

elements.runPipeline.addEventListener("click", runPipeline);
elements.downloadJson.addEventListener("click", downloadJson);

(async function init() {
  await loadFixture();
  log("Browser RAG harness ready.");
  render();
})();
