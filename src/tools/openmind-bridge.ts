import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { repoRoot, resolveFromRoot } from "../core/paths.js";

/**
 * Client for the Open Mind skill bridge.
 *
 * Open Mind (https://github.com/HelloThisWorld/open-mind) ships
 * `openmind/skill_bridge.py`, a JSON-lines stdin/stdout server that runs the REAL
 * Open Mind implementation of its capability skills (glossary, code-graphs,
 * capability-router) against a fixture corpus. This client spawns one bridge
 * process per fixture root (Python imports + the deterministic corpus build are
 * paid once) and multiplexes requests over it.
 *
 * Configuration:
 *   OPENMIND_REPO    path to the open-mind checkout (default: ../open-mind)
 *   OPENMIND_PYTHON  python executable to use (default: "python")
 *
 * The bridge never touches Open Mind's real data directory: OPENMIND_DATA_DIR is
 * pointed at a throwaway temp dir for the child process.
 */

export type BridgeOp = "glossary" | "usage" | "definition" | "route";

interface Pending {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

const READY_TIMEOUT_MS = 120_000; // first start builds the corpus artifacts
const REQUEST_TIMEOUT_MS = 30_000;

export class OpenMindBridge {
  private child: ChildProcess;
  private readonly ready: Promise<Record<string, unknown>>;
  private readonly pending = new Map<number, Pending>();
  private nextId = 0;
  private stderrTail: string[] = [];
  private exited = false;

  constructor(fixtureRoot: string) {
    const openMindRepo = process.env.OPENMIND_REPO ?? resolve(repoRoot(), "..", "open-mind");
    const python = process.env.OPENMIND_PYTHON ?? "python";
    if (!existsSync(join(openMindRepo, "openmind", "skill_bridge.py"))) {
      throw new Error(
        `Open Mind checkout not found at "${openMindRepo}" ` +
          `(expected openmind/skill_bridge.py). Set OPENMIND_REPO to the checkout path.`,
      );
    }

    this.child = spawn(python, ["-m", "openmind.skill_bridge", "--root", resolveFromRoot(fixtureRoot)], {
      cwd: openMindRepo,
      env: {
        ...process.env,
        OPENMIND_DATA_DIR: join(tmpdir(), "openmind-skill-eval-data"),
        PYTHONIOENCODING: "utf-8",
        PYTHONUNBUFFERED: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stderrRl = createInterface({ input: this.child.stderr! });
    stderrRl.on("line", (line) => {
      this.stderrTail.push(line);
      if (this.stderrTail.length > 20) this.stderrTail.shift();
    });

    let readyResolve!: (v: Record<string, unknown>) => void;
    let readyReject!: (e: Error) => void;
    this.ready = new Promise((res, rej) => {
      readyResolve = res;
      readyReject = rej;
    });
    const readyTimer = setTimeout(() => {
      readyReject(new Error(`Open Mind bridge did not become ready within ${READY_TIMEOUT_MS} ms`));
    }, READY_TIMEOUT_MS);

    const rl = createInterface({ input: this.child.stdout! });
    let isReady = false;
    rl.on("line", (line) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return; // ignore non-JSON noise
      }
      if (!isReady) {
        isReady = true;
        clearTimeout(readyTimer);
        if (msg.ready === true) readyResolve(msg);
        else readyReject(new Error(`Open Mind bridge failed to start: ${msg.error ?? line}`));
        return;
      }
      const pending = this.pending.get(Number(msg.id));
      if (!pending) return;
      this.pending.delete(Number(msg.id));
      clearTimeout(pending.timer);
      if (msg.ok === true) pending.resolve(msg.result as Record<string, unknown>);
      else pending.reject(new Error(`bridge error: ${String(msg.error ?? "unknown")}`));
    });

    this.child.on("exit", (code) => {
      this.exited = true;
      clearTimeout(readyTimer);
      const detail = this.stderrTail.length ? `\n${this.stderrTail.join("\n")}` : "";
      const err = new Error(`Open Mind bridge exited with code ${code}${detail}`);
      if (!isReady) readyReject(err);
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(err);
      }
      this.pending.clear();
    });
    // Swallow late rejections when nobody is awaiting ready anymore.
    this.ready.catch(() => {});

    // Don't let an idle bridge keep the Node process alive after the eval is
    // done: pending requests hold a ref'd timer, so the loop stays alive exactly
    // while work is in flight.
    this.child.unref();
    for (const stream of [this.child.stdin, this.child.stdout, this.child.stderr]) {
      (stream as unknown as { unref?: () => void } | null)?.unref?.();
    }
    process.once("exit", () => this.dispose());
  }

  /** One request/response round trip. Rejects on bridge error or timeout. */
  async request(op: BridgeOp, arg: string): Promise<Record<string, unknown>> {
    await this.ready;
    if (this.exited) throw new Error("Open Mind bridge process has exited");
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`bridge request timed out after ${REQUEST_TIMEOUT_MS} ms (op=${op})`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin!.write(`${JSON.stringify({ id, op, arg })}\n`, (err) => {
        if (err) {
          this.pending.delete(id);
          clearTimeout(timer);
          reject(err);
        }
      });
    });
  }

  /** Startup info from the bridge's ready line (files/terms/definitions counts). */
  async info(): Promise<Record<string, unknown>> {
    return this.ready;
  }

  dispose(): void {
    if (!this.exited) this.child.kill();
  }
}

const bridges = new Map<string, OpenMindBridge>();

/** One shared bridge per fixture root — tool registries are recreated per run,
 * but the Python process (imports + corpus build) is paid only once per eval. */
export function getOpenMindBridge(fixtureRoot: string): OpenMindBridge {
  let bridge = bridges.get(fixtureRoot);
  if (!bridge) {
    bridge = new OpenMindBridge(fixtureRoot);
    bridges.set(fixtureRoot, bridge);
  }
  return bridge;
}
