// Generate testcases/glossary.json from the offline snapshot index, so the test
// cases' expected citation files and required symbols always match the cache.
// Run after (re)building the cache: `node scripts/gen-glossary-testcases.mjs`

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "fixtures", "wikipedia", "index.json"), "utf8"));

const cases = index.entries.map((e) => ({
  id: `gl_${e.query.replace(/\s+/g, "_")}`,
  name: `glossary ${e.query}`,
  kind: "happy",
  input: { question: `glossary ${e.query}` },
  expectedStatus: "answered",
  requiredSymbols: [e.query],
  forbiddenClaims: [],
  requiredTools: ["wikipedia_search", "wikipedia_fetch"],
  expectedCitationFiles: [e.file],
}));

writeFileSync(
  join(ROOT, "testcases", "glossary.json"),
  `${JSON.stringify(cases, null, 2)}\n`,
  "utf8",
);
console.log(`Wrote ${cases.length} glossary test cases to testcases/glossary.json`);
