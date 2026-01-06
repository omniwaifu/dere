/**
 * Minimal test workflow to verify temporal setup.
 */

import { log } from "@temporalio/workflow";

export async function testWorkflow(input: { message: string }): Promise<string> {
  log.info("Test workflow started", { message: input.message });
  return `Hello from workflow: ${input.message}`;
}
