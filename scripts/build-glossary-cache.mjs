// Build the offline Wikipedia fixture cache for the `glossary` skill.
//
// For each glossary term this fetches the article intro from English Wikipedia
// (MediaWiki action API) and writes a citable "source snapshot" HTML page to
// fixtures/wikipedia/<term>.html. Each snapshot embeds a machine-readable
// <script id="glossary-data"> JSON block so the tools and adapter can recover
// structured fields without re-hitting the network.
//
// Run once (network required): `npm run glossary:build-cache`
// After that, the eval runs FULLY OFFLINE and deterministically against these
// fixtures — matching the template's offline-first philosophy.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FORCE = process.argv.includes("--force");
const THROTTLE_MS = 1500;

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT_DIR = join(ROOT, "fixtures", "wikipedia");

// The 32 glossary terms under test.
const TERMS = [
  "Mexico", "South Africa", "Switzerland", "Canada", "Bosnia and Herzegovina",
  "Brazil", "Morocco", "United States", "Australia", "Paraguay", "Germany",
  "Ivory Coast", "Ecuador", "Netherlands", "Japan", "Sweden", "Belgium",
  "Egypt", "Spain", "Cape Verde", "France", "Norway", "Senegal", "Argentina",
  "Austria", "Algeria", "Colombia", "Portugal", "Democratic Republic of the Congo",
  "England", "Croatia", "Ghana",
];

const LANG = "en";
const ENDPOINT = "https://en.wikipedia.org/w/api.php";
const HEADERS = {
  "User-Agent": "agent-skill-verification-template/0.1 glossary-skill (offline fixture builder; demo)",
  "Accept-Language": "en",
};

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Split an extract into sentences, paragraph by paragraph. English sentences
 * end with [.!?] followed by whitespace and an uppercase/quote/paren start;
 * this keeps common abbreviations (e.g. "U.S. states") intact well enough for
 * display purposes.
 */
function splitSentences(text) {
  const out = [];
  for (const para of String(text).split(/\r?\n+/)) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    for (const part of trimmed.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)) {
      const s = part.trim();
      if (s) out.push(s);
    }
  }
  return out.length > 0 ? out : [String(text).trim()].filter(Boolean);
}

async function fetchWithRetry(url, tries = 5) {
  let wait = 3000;
  for (let attempt = 1; attempt <= tries; attempt++) {
    const res = await fetch(url, { headers: HEADERS });
    if (res.ok) return res;
    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : wait;
      if (attempt < tries) {
        console.log(`   ${res.status} — backing off ${Math.round(delay / 1000)}s (attempt ${attempt}/${tries})`);
        await sleep(delay);
        wait = Math.min(wait * 2, 30000);
        continue;
      }
    }
    throw new Error(`HTTP ${res.status}`);
  }
  throw new Error("exhausted retries");
}

async function fetchArticle(term) {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    prop: "extracts|description|info|pageimages",
    exintro: "1",
    explaintext: "1",
    redirects: "1",
    inprop: "url",
    piprop: "thumbnail",
    pithumbsize: "320",
    titles: term,
  });
  const res = await fetchWithRetry(`${ENDPOINT}?${params.toString()}`);
  const json = await res.json();
  const pages = json?.query?.pages ?? {};
  const key = Object.keys(pages)[0];
  const page = key ? pages[key] : undefined;
  if (!page || page.missing !== undefined || !page.extract) {
    throw new Error("no article / empty extract");
  }
  return {
    query: term,
    title: page.title,
    description: page.description ?? "",
    url: page.fullurl ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
    thumbnail: page.thumbnail?.source ?? "",
    lang: LANG,
    extract: page.extract.trim(),
    source: "en.wikipedia.org action API (prop=extracts, exintro)",
    retrievedAt: new Date().toISOString(),
  };
}

/**
 * Render the cached "source snapshot" page. The first content line (`lede`)
 * deliberately contains the EXACT query term verbatim so it is always a valid,
 * relevant citation target even when Wikipedia's canonical title or opening
 * phrasing differs from the query.
 */
function renderSnapshot(data) {
  const sentences = splitSentences(data.extract);
  const firstSentence = sentences[0] ?? data.extract;
  const lede = `${data.query} (Wikipedia article: ${data.title}) — ${data.description || "Wikipedia entry"}. ${firstSentence}`;
  const json = JSON.stringify({ ...data, sentences }, null, 2);

  const lines = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    `<title>${esc(data.query)} — Wikipedia snapshot</title>`,
    "</head>",
    "<body>",
    `<h1 class="term">${esc(data.query)}</h1>`,
    `<p class="lede">${esc(lede)}</p>`,
    `<p class="description">Description: ${esc(data.description || "(none)")}</p>`,
    '<section class="extract">',
    ...sentences.map((s) => `<p>${esc(s)}</p>`),
    "</section>",
    `<p class="source">Source: <a href="${esc(data.url)}">${esc(data.url)}</a> (${esc(data.source)})</p>`,
    '<script type="application/json" id="glossary-data">',
    json,
    "</script>",
    "</body>",
    "</html>",
    "",
  ];
  return lines.join("\n");
}

/** Recover the embedded glossary-data JSON from a cached snapshot file. */
function readSnapshotData(file) {
  const html = readFileSync(file, "utf8");
  const m = html.match(/<script type="application\/json" id="glossary-data">\s*([\s\S]*?)\s*<\/script>/);
  return m ? JSON.parse(m[1]) : null;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const failures = [];
  let fetched = 0;
  let skipped = 0;

  for (const term of TERMS) {
    const fileName = `${term}.html`;
    const absFile = join(OUT_DIR, fileName);
    if (!FORCE && existsSync(absFile)) {
      skipped++;
      console.log(`skip ${term.padEnd(34)} (cached)`);
      continue;
    }
    try {
      const data = await fetchArticle(term);
      writeFileSync(absFile, renderSnapshot(data), "utf8");
      fetched++;
      console.log(`ok   ${term.padEnd(34)} -> ${data.title} (${data.extract.length} chars)`);
    } catch (err) {
      failures.push({ term, error: String(err.message || err) });
      console.log(`FAIL ${term.padEnd(34)} -> ${String(err.message || err)}`);
    }
    await sleep(THROTTLE_MS);
  }

  // Rebuild the index from whatever snapshots exist on disk (resume-safe).
  const entries = [];
  for (const term of TERMS) {
    const absFile = join(OUT_DIR, `${term}.html`);
    if (!existsSync(absFile)) continue;
    const data = readSnapshotData(absFile);
    if (!data) continue;
    entries.push({
      query: term,
      title: data.title,
      file: `fixtures/wikipedia/${term}.html`,
      url: data.url,
      description: data.description,
    });
  }

  writeFileSync(
    join(OUT_DIR, "index.json"),
    `${JSON.stringify({ lang: LANG, count: entries.length, entries }, null, 2)}\n`,
    "utf8",
  );

  console.log(
    `\nSnapshots: ${entries.length}/${TERMS.length} on disk (fetched ${fetched}, skipped ${skipped}).`,
  );
  if (failures.length > 0) {
    console.log(`Failures this run: ${failures.map((f) => f.term).join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
