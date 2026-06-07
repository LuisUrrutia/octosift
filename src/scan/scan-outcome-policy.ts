import type { DotfilesCandidate, ScanResult, ScanWarning } from "../domain/types";
import { EXIT_CODE_PARTIAL_FAILURE, EXIT_CODE_RATE_LIMIT_EXHAUSTED, EXIT_CODE_SUCCESS } from "../domain/types";
import { GitHubClientError } from "../github/client";

export type ScanFailureDecision = "continue" | "stop";

export type ScanFailureContext = Pick<ScanWarning, "input" | "repository" | "contributor">;

export interface ScanFailureEvent {
  error: unknown;
  context: ScanFailureContext;
}

export interface ScanOutcomePolicy {
  recordFailure(event: ScanFailureEvent): ScanFailureDecision;
  buildResult(candidates: readonly DotfilesCandidate[]): ScanResult;
}

export function createScanOutcomePolicy(): ScanOutcomePolicy {
  const warnings: ScanWarning[] = [];
  let rateLimited = false;

  return {
    recordFailure(event) {
      const warning = normalizeClientError(event.error, snapshotContext(event.context));
      warnings.push(warning);

      if (warning.code === "rate-limit") {
        rateLimited = true;
        return "stop";
      }

      return "continue";
    },

    buildResult(candidates) {
      return {
        candidates: [...candidates],
        warnings: warnings.map(cloneWarning),
        partialFailure: warnings.length > 0,
        exitCode: rateLimited ? EXIT_CODE_RATE_LIMIT_EXHAUSTED : warnings.length > 0 ? EXIT_CODE_PARTIAL_FAILURE : EXIT_CODE_SUCCESS,
      };
    },
  };
}

function normalizeClientError(error: unknown, context: ScanFailureContext): ScanWarning {
  if (error instanceof GitHubClientError) {
    return withRetryAfter({
      code: error.kind === "rate-limit" ? "rate-limit" : "partial-failure",
      message: error.message,
      input: context.input,
      repository: context.repository,
      contributor: context.contributor,
    }, error.retryAfterSeconds);
  }

  if (isRateLimitLike(error)) {
    return withRetryAfter({
      code: "rate-limit",
      message: error.message,
      input: context.input,
      repository: context.repository,
      contributor: context.contributor,
    }, error.retryAfterSeconds);
  }

  return {
    code: "partial-failure",
    message: error instanceof Error ? error.message : "GitHub request failed.",
    input: context.input,
    repository: context.repository,
    contributor: context.contributor,
  };
}

function isRateLimitLike(error: unknown): error is Error & { retryAfterSeconds?: number; status?: number; remaining?: number } {
  if (!(error instanceof Error)) {
    return false;
  }

  const candidate = error as Error & { retryAfterSeconds?: number; status?: number; remaining?: number };
  return candidate.status === 429 || candidate.remaining === 0 || candidate.retryAfterSeconds !== undefined;
}

function snapshotContext(context: ScanFailureContext): ScanFailureContext {
  return {
    input: context.input,
    repository: context.repository,
    contributor: context.contributor,
  };
}

function cloneWarning(warning: ScanWarning): ScanWarning {
  return { ...warning };
}

function withRetryAfter(warning: ScanWarning, retryAfterSeconds: number | undefined): ScanWarning {
  if (retryAfterSeconds === undefined) {
    return warning;
  }

  return { ...warning, retryAfterSeconds };
}
