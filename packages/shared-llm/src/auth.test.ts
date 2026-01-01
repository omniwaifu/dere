import { describe, expect, test, beforeEach } from "bun:test";

import {
  AuthenticationError,
  isAuthError,
  isAuthFailed,
  markAuthFailed,
  resetAuthState,
} from "./auth.js";

describe("AuthenticationError", () => {
  test("has default message", () => {
    const error = new AuthenticationError();
    expect(error.message).toBe("Claude auth expired. Run 'claude login' to re-authenticate.");
  });

  test("accepts custom message", () => {
    const error = new AuthenticationError("Custom auth error");
    expect(error.message).toBe("Custom auth error");
  });

  test("has correct name", () => {
    const error = new AuthenticationError();
    expect(error.name).toBe("AuthenticationError");
  });
});

describe("isAuthError", () => {
  test.each([
    ["exit code 1", true],
    ["Authentication failed", true],
    ["unauthorized access", true],
    ["not authenticated", true],
    ["login required", true],
    ["token expired", true],
    ["AUTHENTICATION ERROR", true],
    ["network timeout", false],
    ["connection refused", false],
    ["rate limit exceeded", false],
    ["", false],
  ])('"%s" returns %s', (input, expected) => {
    expect(isAuthError(new Error(input))).toBe(expected);
  });

  test("handles non-Error input", () => {
    expect(isAuthError("token expired")).toBe(true);
    expect(isAuthError("random error")).toBe(false);
  });

  test("handles null/undefined", () => {
    expect(isAuthError(null)).toBe(false);
    expect(isAuthError(undefined)).toBe(false);
  });
});

describe("auth state", () => {
  beforeEach(() => {
    resetAuthState();
  });

  test("starts as not failed", () => {
    expect(isAuthFailed()).toBe(false);
  });

  test("markAuthFailed sets state to failed", () => {
    markAuthFailed();
    expect(isAuthFailed()).toBe(true);
  });

  test("resetAuthState clears failed state", () => {
    markAuthFailed();
    expect(isAuthFailed()).toBe(true);

    resetAuthState();
    expect(isAuthFailed()).toBe(false);
  });

  test("multiple markAuthFailed calls are idempotent", () => {
    markAuthFailed();
    markAuthFailed();
    markAuthFailed();
    expect(isAuthFailed()).toBe(true);
  });
});
