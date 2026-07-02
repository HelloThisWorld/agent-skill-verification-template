/**
 * Shared parsing for the offline Wikipedia snapshot pages under
 * `fixtures/wikipedia/`. A snapshot is a small HTML page that embeds a
 * machine-readable `<script id="glossary-data">` JSON block; this module is the
 * single place that reads that block, so the fetch tool, the deliverable
 * renderer, and the CLI never drift on the snapshot format.
 */

/** Structured data embedded in each Wikipedia snapshot page. */
export interface GlossarySnapshotData {
  /** The exact glossary query term this snapshot answers (as provided). */
  query: string;
  /** The canonical Wikipedia article title the query resolved to. */
  title: string;
  description: string;
  url: string;
  thumbnail: string;
  lang: string;
  extract: string;
  source: string;
  retrievedAt: string;
  sentences: string[];
}

export interface ParsedSnapshot {
  data: GlossarySnapshotData;
  /** 1-indexed line of the citable "lede" line (contains the exact query). */
  ledeLine: number;
  lineCount: number;
}

const DATA_RE =
  /<script type="application\/json" id="glossary-data">\s*([\s\S]*?)\s*<\/script>/;

/** Parse a snapshot's HTML into structured data + the citable lede line number. */
export function parseSnapshot(html: string): ParsedSnapshot | null {
  const match = html.match(DATA_RE);
  if (!match) return null;
  let data: GlossarySnapshotData;
  try {
    data = JSON.parse(match[1]) as GlossarySnapshotData;
  } catch {
    return null;
  }

  const lines = html.split(/\r?\n/);
  let ledeLine = lines.findIndex((l) => l.includes('class="lede"')) + 1;
  if (ledeLine === 0) {
    // Fall back to the first line that contains the query verbatim.
    ledeLine = Math.max(1, lines.findIndex((l) => l.includes(data.query)) + 1);
  }

  return { data, ledeLine, lineCount: lines.length };
}
