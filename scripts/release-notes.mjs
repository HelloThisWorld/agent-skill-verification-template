import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Generate the GitHub Release notes for the current package version and print
 * them to stdout. The changelog section for the version (from CHANGELOG.md) is
 * embedded when present, followed by a stable installation and verification
 * guide.
 *
 * Usage: node scripts/release-notes.mjs > release-notes.md
 */

const root = process.cwd();
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const version = pkg.version;

function changelogSection() {
  const path = resolve(root, "CHANGELOG.md");
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith("## ") && l.includes(version));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      end = i;
      break;
    }
  }
  return lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
}

const changelog = changelogSection();

const notes = `${changelog ?? `First downloadable release of the Agent Skill Verifier CLI.`}

## Installation

| Platform | Asset |
|----------|-------|
| Windows x64 | \`agent-skill-verifier-v${version}-windows-x64.zip\` |
| Linux x64 | \`agent-skill-verifier-v${version}-linux-x64.tar.gz\` |
| macOS x64 (Intel) | \`agent-skill-verifier-v${version}-macos-x64.tar.gz\` |
| macOS arm64 (Apple silicon) | \`agent-skill-verifier-v${version}-macos-arm64.tar.gz\` |
| Any platform with Node.js >= 18.18 | \`agent-skill-verifier-v${version}-node.zip\` |

Extract the archive and run the \`agent-skill-verifier\` executable inside
(\`agent-skill-verifier.exe\` on Windows; \`node agent-skill-verifier.cjs\` for
the portable bundle). See QUICKSTART.md inside each archive.

## Verify your download

\`SHA256SUMS.txt\` lists the SHA-256 of every asset:

\`\`\`bash
sha256sum -c --ignore-missing SHA256SUMS.txt   # Linux
shasum -a 256 -c --ignore-missing SHA256SUMS.txt   # macOS
Get-FileHash agent-skill-verifier-v${version}-windows-x64.zip -Algorithm SHA256   # Windows
\`\`\`

Checksums detect corrupted or tampered downloads; they do not prove publisher
identity. **Binaries are not code-signed** — Windows SmartScreen and macOS
Gatekeeper may warn before the first run.

## Notes and limitations

- \`verify\` runs are fully offline with the built-in \`mock\`/\`mock-flaky\`
  adapters; live-model adapters read their credentials from environment
  variables only.
- \`replay\` is stored-artifact inspection: it presents the recorded input,
  output, tool trace, and validation verdict without invoking a model.
- Exit codes: 0 passed · 1 quality gate failed · 2 invalid input ·
  3 adapter unavailable · 4 runtime failure · 5 timeout · 6 artifact failure.
`;

process.stdout.write(notes);
