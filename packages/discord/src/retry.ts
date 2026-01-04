export type RetryOptions = {
  maxRetries?: number;
  baseDelaySeconds?: number;
  operationName?: string;
};

export function exponentialBackoffRetry<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options: RetryOptions = {},
): (...args: TArgs) => Promise<TResult> {
  const maxRetries = options.maxRetries ?? 5;
  const baseDelay = options.baseDelaySeconds ?? 1.0;
  const operationName = options.operationName ?? "operation";

  return async (...args: TArgs) => {
    for (let attempt = 0; attempt < maxRetries; attempt += 1) {
      try {
        return await fn(...args);
      } catch (error) {
        if (attempt < maxRetries - 1) {
          const delay = baseDelay * 2 ** attempt;
          console.warn(
            `Failed ${operationName} (attempt ${attempt + 1}/${maxRetries}): ${String(
              error,
            )} - retrying in ${delay}s`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay * 1000));
          continue;
        }
        console.error(`Failed ${operationName} after ${maxRetries} attempts: ${String(error)}`);
        throw error;
      }
    }
    throw new Error(`Failed ${operationName} after ${maxRetries} attempts`);
  };
}
