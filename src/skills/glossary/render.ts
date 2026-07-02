import type { GlossarySnapshotData } from "./snapshot.js";

/**
 * Presentation layer for the `glossary` skill: render the grounded Wikipedia
 * snapshot into a self-contained web page (no server, no CDN). This is the
 * skill's user-facing deliverable — the "result as a web page" — while the
 * structured SkillOutput graded by the verifier is the machine-checkable
 * envelope that proves the page is source-grounded.
 */

function esc(input: unknown): string {
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function badge(result: "PASSED" | "FAILED"): string {
  const cls = result === "PASSED" ? "badge badge-pass" : "badge badge-fail";
  return `<span class="${cls}">${result}</span>`;
}

/** Grading/citation metadata shown on a card, if available. */
export interface GlossaryCardMeta {
  citationFile?: string;
  citationLine?: number;
  passRate?: number;
  result?: "PASSED" | "FAILED";
  runs?: number;
}

const CARD_STYLE = `
  :root {
    --bg:#f5f7fa; --panel:#fff; --ink:#1a2233; --muted:#667085; --line:#e4e7ec;
    --accent:#3b5bdb; --pass-ink:#087443; --pass-bg:#e6f6ec; --fail-ink:#b42318; --fail-bg:#fdeceb;
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); line-height:1.7;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  .wrap { max-width:820px; margin:0 auto; padding:32px 20px 64px; }
  a { color:var(--accent); }
  .back { font-size:13px; }
  header.hero { background:linear-gradient(135deg,#1e293b 0%,#3b5bdb 100%); color:#fff;
    border-radius:16px; padding:26px 30px; margin:14px 0 24px; display:flex; gap:22px; align-items:center; }
  header.hero img { width:96px; height:auto; border-radius:8px; background:#fff; padding:4px; }
  header.hero h1 { margin:0 0 4px; font-size:30px; letter-spacing:.01em; }
  header.hero .canon { color:#cdd6f4; font-size:14px; }
  .desc-badge { display:inline-block; margin-top:8px; background:rgba(255,255,255,.16); color:#fff;
    padding:3px 12px; border-radius:999px; font-size:13px; }
  .badge { display:inline-block; padding:3px 12px; border-radius:999px; font-size:13px; font-weight:700; }
  .badge-pass { color:var(--pass-ink); background:var(--pass-bg); }
  .badge-fail { color:var(--fail-ink); background:var(--fail-bg); }
  section.def { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:8px 24px; }
  section.def p { margin:14px 0; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:26px 0 10px; }
  .infobox { width:100%; border-collapse:collapse; background:var(--panel); border:1px solid var(--line);
    border-radius:12px; overflow:hidden; font-size:13.5px; }
  .infobox th,.infobox td { text-align:left; padding:10px 14px; border-bottom:1px solid var(--line); vertical-align:top; }
  .infobox th { background:#fafbfc; color:var(--muted); font-weight:600; white-space:nowrap; width:150px; }
  .infobox tr:last-child td,.infobox tr:last-child th { border-bottom:none; }
  code { background:#f2f4f7; padding:1px 6px; border-radius:5px; font-size:12.5px;
    font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
  footer { margin-top:34px; color:var(--muted); font-size:12px; text-align:center; }
`;

/** Render one term's glossary page from its grounded snapshot. */
export function renderGlossaryCard(data: GlossarySnapshotData, meta: GlossaryCardMeta = {}): string {
  const sentences = data.sentences.length > 0 ? data.sentences : [data.extract];
  const paragraphs = sentences.map((s) => `<p>${esc(s)}</p>`).join("\n        ");
  const thumb = data.thumbnail
    ? `<img src="${esc(data.thumbnail)}" alt="${esc(data.query)}" />`
    : "";
  const gradeRow =
    meta.result !== undefined
      ? `
        <tr><th>Verification</th><td>${badge(meta.result)} &nbsp; pass rate ${pct(meta.passRate ?? 0)} (${meta.runs ?? 0} runs)</td></tr>`
      : "";
  const citationRow =
    meta.citationFile !== undefined
      ? `
        <tr><th>Citation</th><td><code>${esc(meta.citationFile)}:${esc(meta.citationLine ?? "")}</code></td></tr>`
      : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Glossary: ${esc(data.query)}</title>
<style>${CARD_STYLE}</style>
</head>
<body>
  <div class="wrap">
    <a class="back" href="index.html">← Back to glossary index</a>
    <header class="hero">
      ${thumb}
      <div>
        <h1>${esc(data.query)}</h1>
        <div class="canon">Wikipedia article: ${esc(data.title)}</div>
        ${data.description ? `<div class="desc-badge">${esc(data.description)}</div>` : ""}
      </div>
    </header>

    <h2>Definition</h2>
    <section class="def">
        ${paragraphs}
    </section>

    <h2>Fact sheet</h2>
    <table class="infobox">
      <tbody>
        <tr><th>Query term</th><td>${esc(data.query)}</td></tr>
        <tr><th>Wikipedia title</th><td>${esc(data.title)}</td></tr>
        <tr><th>Description</th><td>${esc(data.description || "(none)")}</td></tr>
        <tr><th>Language</th><td><code>${esc(data.lang)}</code></td></tr>
        <tr><th>Source</th><td><a href="${esc(data.url)}">${esc(data.url)}</a></td></tr>${gradeRow}${citationRow}
      </tbody>
    </table>

    <footer>
      Content from Wikipedia (${esc(data.source)}), licensed under CC BY-SA.<br />
      Rendered by the glossary skill from an offline snapshot and verified for
      source grounding by the Agent Skill Verification Template.
    </footer>
  </div>
</body>
</html>
`;
}

export interface GlossaryIndexEntry {
  query: string;
  title: string;
  /** Deliverable page filename, e.g. `Mexico.html`. */
  page: string;
  description: string;
  passRate: number;
  result: "PASSED" | "FAILED";
  runs: number;
}

export interface GlossaryIndexParams {
  entries: GlossaryIndexEntry[];
  skill: string;
  skillVersion: string;
  model: string;
  generatedAt: string;
  overallResult: "PASSED" | "FAILED";
  overallPassRate: number;
  reportHref: string;
}

const INDEX_STYLE =
  CARD_STYLE +
  `
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(190px,1fr)); gap:12px; }
  .tile { display:block; background:var(--panel); border:1px solid var(--line); border-radius:12px;
    padding:14px 16px; text-decoration:none; color:var(--ink); transition:border-color .15s,box-shadow .15s; }
  .tile:hover { border-color:var(--accent); box-shadow:0 2px 10px rgba(59,91,219,.10); }
  .tile .q { font-size:17px; font-weight:650; }
  .tile .t { font-size:12.5px; color:var(--muted); margin:2px 0 8px; }
  .dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px; }
  .dot-pass { background:var(--pass-ink); } .dot-fail { background:var(--fail-ink); }
  .summary { display:flex; gap:22px; flex-wrap:wrap; color:var(--muted); font-size:14px; margin:2px 0 6px; }
`;

/** Render the glossary index page linking to every term's card. */
export function renderGlossaryIndex(params: GlossaryIndexParams): string {
  const tiles = params.entries
    .map(
      (e) => `
      <a class="tile" href="${esc(e.page)}">
        <div class="q">${esc(e.query)}</div>
        <div class="t">${esc(e.title)}${e.description ? ` · ${esc(e.description)}` : ""}</div>
        <div><span class="dot ${e.result === "PASSED" ? "dot-pass" : "dot-fail"}"></span>${badge(e.result)} <span style="color:var(--muted);font-size:12px">${pct(e.passRate)}</span></div>
      </a>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Wikipedia Glossary — ${esc(params.skill)}</title>
<style>${INDEX_STYLE}</style>
</head>
<body>
  <div class="wrap">
    <header class="hero">
      <div>
        <h1>Wikipedia Glossary</h1>
        <div class="canon">Skill <code style="background:rgba(255,255,255,.18);color:#fff">${esc(params.skill)}</code> v${esc(params.skillVersion)} · Model <code style="background:rgba(255,255,255,.18);color:#fff">${esc(params.model)}</code> · Generated ${esc(params.generatedAt)}</div>
        <div class="desc-badge">Overall ${params.overallResult} · pass rate ${pct(params.overallPassRate)}</div>
      </div>
    </header>

    <div class="summary">
      <div>Terms: <strong>${params.entries.length}</strong></div>
      <div>Verification report: <a href="${esc(params.reportHref)}">report.html</a></div>
    </div>

    <h2>Terms (click to open a page)</h2>
    <div class="grid">${tiles}
    </div>

    <footer>
      Each term page is rendered by the glossary skill from an offline Wikipedia
      snapshot; the verification harness checks its source grounding (the cited
      line must carry the query term).
    </footer>
  </div>
</body>
</html>
`;
}
