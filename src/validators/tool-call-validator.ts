import type { ValidatorResult } from "../core/types.js";
import type { ValidatorInput } from "./validation-summary.js";
import { VALIDATOR_NAMES } from "./validation-summary.js";

/**
 * Tool-call validator — checks the skill honored the tool contract.
 *
 *   - Required tools: every tool the test case requires must have been called.
 *   - Order: for each adjacent pair in the contract's `toolOrder`, if both tools
 *     were used, the first must appear before the second (e.g. `repo_search`
 *     before `read_file`). Tools not present impose no ordering constraint.
 */
export function validateToolCalls(input: ValidatorInput): ValidatorResult {
  const { output, testCase, contract } = input;
  const reasons: string[] = [];

  const calledNames = output.toolCalls.map((t) => t.tool);
  const firstIndex = (name: string): number => calledNames.indexOf(name);

  for (const required of testCase.requiredTools) {
    if (!calledNames.includes(required)) {
      reasons.push(`required_tool_not_called: ${required}`);
    }
  }

  const order = contract.toolOrder;
  for (let i = 0; i < order.length - 1; i++) {
    const a = order[i];
    const b = order[i + 1];
    const ia = firstIndex(a);
    const ib = firstIndex(b);
    if (ia !== -1 && ib !== -1 && ia > ib) {
      reasons.push(`tool_order_violation: ${a} must come before ${b}`);
    }
  }

  return {
    validator: VALIDATOR_NAMES.toolCall,
    passed: reasons.length === 0,
    reasons,
    details: { calledTools: calledNames },
  };
}
