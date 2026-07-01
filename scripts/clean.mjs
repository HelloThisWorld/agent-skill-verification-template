// Cross-platform clean script. Removes build output and generated reports.
import { rmSync } from "node:fs";

const targets = ["dist", "reports/latest", "reports/latest-flaky"];

for (const target of targets) {
  rmSync(target, { recursive: true, force: true });
  console.log(`removed ${target}`);
}
