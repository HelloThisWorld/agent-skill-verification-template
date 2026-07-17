import { build } from "esbuild";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Bundle the CLI into a single self-contained CommonJS file:
 * dist/cli/agent-skill-verifier.cjs
 *
 * - Every npm dependency (commander, zod, yaml) is inlined; only Node
 *   builtins remain as require() calls, which the Node SEA runtime supports.
 * - The version is injected at build time so the bundle never reads
 *   package.json at runtime.
 * - No source maps are emitted (release artifacts must not embed local
 *   absolute paths).
 */

const root = process.cwd();
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

export const CLI_BUNDLE_PATH = "dist/cli/agent-skill-verifier.cjs";

export async function buildCliBundle() {
  mkdirSync(resolve(root, "dist/cli"), { recursive: true });
  await build({
    entryPoints: [resolve(root, "src/cli/main.ts")],
    outfile: resolve(root, CLI_BUNDLE_PATH),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node18",
    sourcemap: false,
    minify: false,
    legalComments: "inline",
    define: {
      __ASV_VERSION__: JSON.stringify(pkg.version),
    },
    logLevel: "warning",
  });
  return { bundlePath: CLI_BUNDLE_PATH, version: pkg.version };
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith("build-cli.mjs");
if (invokedDirectly) {
  const { bundlePath, version } = await buildCliBundle();
  console.log(`Built ${bundlePath} (version ${version})`);
}
