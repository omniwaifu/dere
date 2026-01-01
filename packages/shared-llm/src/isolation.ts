/**
 * Working directory isolation for internal LLM calls.
 * Prevents contamination from user project context.
 */

export const ISOLATED_WORKING_DIR = "/tmp/dere-llm-sessions";
