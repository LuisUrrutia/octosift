import { expect, test } from "bun:test";

import { parseCommandIntent } from "../src/cli/command-intent";

test("classifies empty args and exclusive commands", () => {
  expect(parseCommandIntent([])).toEqual({ intent: { kind: "help" } });
  expect(parseCommandIntent(["--help"])).toEqual({ intent: { kind: "help" } });
  expect(parseCommandIntent(["--version"])).toEqual({ intent: { kind: "version" } });
  expect(parseCommandIntent(["--clear-cache"])).toEqual({ intent: { kind: "clear-cache" } });
});

test("builds complete scan intent with defaults", () => {
  expect(expectIntent(["--format", "csv"])).toEqual({
    kind: "scan",
    inputArgs: [],
    format: "csv",
    minScore: 3,
    maxContributors: 50,
    maxRepos: undefined,
    useCache: true,
    cacheTtlSeconds: 21600,
  });
});

test("supports equals-form value flags and canonicalizes file inputs", () => {
  expect(expectIntent([
    "--format=csv",
    "--min-score=2.5",
    "--max-contributors",
    "25",
    "--max-repos=10",
    "--cache-ttl=60",
    "--no-cache",
    "--file=inputs.txt",
    "@more.txt",
    "alice",
  ])).toEqual({
    kind: "scan",
    inputArgs: ["--file", "inputs.txt", "@more.txt", "alice"],
    format: "csv",
    minScore: 2.5,
    maxContributors: 25,
    maxRepos: 10,
    useCache: false,
    cacheTtlSeconds: 60,
  });
});

test("allows repeated file inputs and repeated no-cache", () => {
  const intent = expectIntent(["--file", "one.txt", "--file=two.txt", "--no-cache", "--no-cache", "alice"]);

  expect(intent).toEqual({
    kind: "scan",
    inputArgs: ["--file", "one.txt", "--file", "two.txt", "alice"],
    format: "json",
    minScore: 3,
    maxContributors: 50,
    maxRepos: undefined,
    useCache: false,
    cacheTtlSeconds: 21600,
  });
});

test("rejects short flags, option terminator, and unknown long flags", () => {
  expect(expectErrors(["-h", "--", "--unknown"])).toEqual([
    "Unknown option: -h",
    "Unknown option: --",
    "Unknown option: --unknown",
  ]);
});

test("rejects equals values for presence-only flags while keeping following tokens as inputs", () => {
  expect(expectErrors(["--help=true", "--version=false", "--clear-cache=1", "--no-cache=false"])).toEqual([
    "--help does not take a value.",
    "--version does not take a value.",
    "--clear-cache does not take a value.",
    "--no-cache does not take a value.",
  ]);

  const intent = expectIntent(["--no-cache", "alice"]);
  expect(intent.kind).toBe("scan");
  if (intent.kind === "scan") {
    expect(intent.inputArgs).toEqual(["alice"]);
    expect(intent.useCache).toBe(false);
  }
});

test("rejects exclusive commands mixed with scan flags or other exclusive commands", () => {
  expect(expectErrors(["--help", "--format", "xml", "alice"])).toEqual([
    "--help cannot be combined with scan inputs or flags",
    "--format must be one of: json, csv",
  ]);
  expect(expectErrors(["--help", "--version"])).toEqual([
    "Only one exclusive command can be used: --help, --version, or --clear-cache",
  ]);
});

test("rejects duplicate scalar flags", () => {
  expect(expectErrors(["--format", "json", "--format", "csv", "alice"])).toEqual(["Duplicate --format."]);
});

test("rejects missing and invalid values in argument order", () => {
  expect(expectErrors(["--format=", "--file=", "--max-repos", "0", "--cache-ttl", "1.5"])).toEqual([
    "Missing value for --format.",
    "Missing value for --file.",
    "Invalid --max-repos value: 0. Expected a finite integer 1 or greater.",
    "Invalid --cache-ttl value: 1.5. Expected a finite integer 0 or greater.",
  ]);
});

function expectIntent(args: readonly string[]): Exclude<ReturnType<typeof parseCommandIntent>, { errors: string[] }>["intent"] {
  const result = parseCommandIntent(args);

  if ("errors" in result) {
    throw new Error(`Expected command intent, got errors: ${result.errors.join(" | ")}`);
  }

  return result.intent;
}

function expectErrors(args: readonly string[]): string[] {
  const result = parseCommandIntent(args);

  if ("intent" in result) {
    throw new Error(`Expected parse errors, got intent: ${JSON.stringify(result.intent)}`);
  }

  return result.errors;
}
