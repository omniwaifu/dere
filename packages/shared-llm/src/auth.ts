/**
 * Authentication error handling for Claude LLM calls.
 * Provides fast-fail behavior and error detection matching Python parity.
 */

export class AuthenticationError extends Error {
  constructor(message = "Claude auth expired. Run 'claude login' to re-authenticate.") {
    super(message);
    this.name = "AuthenticationError";
  }
}

// Module-level auth state (singleton within process)
let authFailed = false;
let authFailureLogged = false;

const AUTH_ERROR_PATTERNS = [
  "exit code 1",
  "authentication",
  "unauthorized",
  "not authenticated",
  "login required",
  "token expired",
];

/**
 * Check if an error indicates an auth failure.
 */
export function isAuthError(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return AUTH_ERROR_PATTERNS.some((p) => msg.includes(p));
}

/**
 * Check if auth has failed (cached state).
 */
export function isAuthFailed(): boolean {
  return authFailed;
}

/**
 * Mark auth as failed. Logs once to avoid spam.
 */
export function markAuthFailed(): void {
  authFailed = true;
  if (!authFailureLogged) {
    authFailureLogged = true;
    console.error(
      "Claude auth token expired. LLM features disabled. Run 'claude login' to re-authenticate.",
    );
  }
}

/**
 * Reset auth failure state (call after successful re-auth).
 */
export function resetAuthState(): void {
  authFailed = false;
  authFailureLogged = false;
}
