import { expect, test } from "bun:test";

import type { SearchCandidate } from "../src/domain/types";
import { EXIT_CODE_PARTIAL_FAILURE, EXIT_CODE_RATE_LIMIT_EXHAUSTED, EXIT_CODE_SUCCESS } from "../src/domain/types";
import { GitHubClientError } from "../src/github/client";
import { createScanOutcomePolicy } from "../src/scan/scan-outcome-policy";

test("scan outcome policy builds successful results from final candidates", () => {
  const policy = createScanOutcomePolicy();
  const candidates = [candidate("alice/dotfiles")];

  const result = policy.buildResult(candidates);

  expect(result.candidates).toEqual(candidates);
  expect(result.warnings).toEqual([]);
  expect(result.partialFailure).toBe(false);
  expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
  expect(result.rateLimit).toBe(undefined);
});

test("scan outcome policy records partial failures and preserves warning context order", () => {
  const policy = createScanOutcomePolicy();
  const firstContext = { input: "bob", contributor: "bob" };
  const firstDecision = policy.recordFailure({
    error: new GitHubClientError({ kind: "forbidden", message: "bob forbidden" }),
    context: firstContext,
  });
  firstContext.input = "mutated";

  const secondDecision = policy.recordFailure({
    error: "not an error",
    context: { input: "charlie", contributor: "charlie" },
  });

  const result = policy.buildResult([candidate("alice/dotfiles")]);

  expect(firstDecision).toBe("continue");
  expect(secondDecision).toBe("continue");
  expect(result.exitCode).toBe(EXIT_CODE_PARTIAL_FAILURE);
  expect(result.partialFailure).toBe(true);
  expect(result.warnings).toEqual([
    { code: "partial-failure", message: "bob forbidden", input: "bob", contributor: "bob" },
    { code: "partial-failure", message: "GitHub request failed.", input: "charlie", contributor: "charlie" },
  ]);

  (result.warnings as unknown as Array<{ message: string }>)[0].message = "external mutation";
  expect(policy.buildResult([]).warnings[0].message).toBe("bob forbidden");
});

test("scan outcome policy stops on rate limits and preserves retry-after", () => {
  const policy = createScanOutcomePolicy();
  const firstDecision = policy.recordFailure({
    error: new GitHubClientError({ kind: "partial", message: "temporary outage" }),
    context: { input: "alice", contributor: "alice" },
  });
  const secondDecision = policy.recordFailure({
    error: new GitHubClientError({ kind: "rate-limit", message: "secondary rate limit", retryAfterSeconds: 45 }),
    context: { input: "org/private", repository: "org/private" },
  });

  const result = policy.buildResult([candidate("alice/dotfiles")]);

  expect(firstDecision).toBe("continue");
  expect(secondDecision).toBe("stop");
  expect(result.exitCode).toBe(EXIT_CODE_RATE_LIMIT_EXHAUSTED);
  expect(result.partialFailure).toBe(true);
  expect(result.warnings).toEqual([
    { code: "partial-failure", message: "temporary outage", input: "alice", contributor: "alice" },
    { code: "rate-limit", message: "secondary rate limit", input: "org/private", repository: "org/private", retryAfterSeconds: 45 },
  ]);
});

test("scan outcome policy treats rate-limit-like generic errors as hard stops", () => {
  const policy = createScanOutcomePolicy();
  const error = new Error("rate limited") as Error & { retryAfterSeconds?: number; remaining?: number };
  error.retryAfterSeconds = 30;
  error.remaining = 0;

  const decision = policy.recordFailure({ error, context: { input: "bob", contributor: "bob" } });
  const result = policy.buildResult([]);

  expect(decision).toBe("stop");
  expect(result.exitCode).toBe(EXIT_CODE_RATE_LIMIT_EXHAUSTED);
  expect(result.warnings).toEqual([{ code: "rate-limit", message: "rate limited", input: "bob", contributor: "bob", retryAfterSeconds: 30 }]);
});

test("scan outcome policy export surface and dependencies stay narrow", async () => {
  const exports = await import("../src/scan/scan-outcome-policy");
  const source = await Bun.file(new URL("../src/scan/scan-outcome-policy.ts", import.meta.url).pathname).text();

  expect(Object.keys(exports).sort()).toEqual(["createScanOutcomePolicy"]);
  expect(source.includes("../github/client")).toBe(true);
  expect(source.includes("../rules/scoring")).toBe(false);
  expect(source.includes("../rules/bots")).toBe(false);
  expect(source.includes("../input/")).toBe(false);
  expect(source.includes("../cli/")).toBe(false);
  expect(source.includes("./candidate-ledger")).toBe(false);
});

function candidate(fullName: string): SearchCandidate {
  const [owner, name] = fullName.split("/");

  return {
    url: `https://github.com/${fullName}`,
    owner,
    name,
    fullName,
    description: null,
    topics: [],
    stars: 0,
    forks: 0,
    language: null,
    isFork: false,
    isArchived: false,
    updatedAt: null,
    pushedAt: null,
    matchedSignals: [],
    score: 0,
    sourceUser: [owner],
    sourceInput: [owner],
  };
}
