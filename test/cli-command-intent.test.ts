import { expect, test } from "bun:test";

import { parseCommandIntent } from "../src/cli/command-intent";

test("classifies empty args and exclusive commands", () => {
  expect(parseCommandIntent([])).toEqual({ intent: { kind: "help" } });
  expect(parseCommandIntent(["--help"])).toEqual({ intent: { kind: "help" } });
  expect(parseCommandIntent(["--version"])).toEqual({ intent: { kind: "version" } });
  expect(parseCommandIntent(["--clear-cache"])).toEqual({ intent: { kind: "clear-cache" } });
});

test("builds complete scan intent with defaults", () => {
  expect(expectIntent(["dotfiles", "--format", "csv"])).toEqual({
    kind: "scan",
    searchIntent: "dotfiles",
    inputArgs: [],
    format: "csv",
    minScore: 3,
    maxContributors: 50,
    maxRepos: undefined,
    useCache: true,
    cacheTtlSeconds: 259200,
    verbose: false,
    ignoreForks: false,
    configDir: undefined,
  });
});

test("accepts arbitrary first positional token as the search intent", () => {
  expect(expectIntent(["homebrew", "alice"])).toMatchObject({
    kind: "scan",
    searchIntent: "homebrew",
    inputArgs: ["alice"],
  });

  expect(expectIntent(["--format", "csv", "homebrew", "alice"])).toMatchObject({
    kind: "scan",
    searchIntent: "homebrew",
    inputArgs: ["alice"],
  });
});

test("accepts skills search intent as scan command", () => {
  expect(expectIntent(["skills", "alice"])).toEqual({
    kind: "scan",
    searchIntent: "skills",
    inputArgs: ["alice"],
    format: "json",
    minScore: 3,
    maxContributors: 50,
    maxRepos: undefined,
    useCache: true,
    cacheTtlSeconds: 259200,
    verbose: false,
    ignoreForks: false,
    configDir: undefined,
  });
});

test("supports config-dir as a scalar value flag", () => {
  expect(expectIntent(["homebrew", "--config-dir", "custom-config", "alice"])).toMatchObject({
    kind: "scan",
    searchIntent: "homebrew",
    inputArgs: ["alice"],
    configDir: "custom-config",
  });
});

test("supports equals-form value flags and canonicalizes file inputs", () => {
  expect(expectIntent([
    "dotfiles",
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
    searchIntent: "dotfiles",
    inputArgs: ["--file", "inputs.txt", "@more.txt", "alice"],
    format: "csv",
    minScore: 2.5,
    maxContributors: 25,
    maxRepos: 10,
    useCache: false,
    cacheTtlSeconds: 60,
    verbose: false,
    ignoreForks: false,
    configDir: undefined,
  });
});

test("allows repeated file inputs and repeated no-cache", () => {
  const intent = expectIntent(["dotfiles", "--file", "one.txt", "--file=two.txt", "--no-cache", "--no-cache", "alice"]);

  expect(intent).toEqual({
    kind: "scan",
    searchIntent: "dotfiles",
    inputArgs: ["--file", "one.txt", "--file", "two.txt", "alice"],
    format: "json",
    minScore: 3,
    maxContributors: 50,
    maxRepos: undefined,
    useCache: false,
    cacheTtlSeconds: 259200,
    verbose: false,
    ignoreForks: false,
    configDir: undefined,
  });
});

test("supports verbose as a presence-only scan flag", () => {
  const intent = expectIntent(["dotfiles", "--verbose", "alice"]);

  expect(intent.kind).toBe("scan");
  if (intent.kind === "scan") {
    expect(intent.verbose).toBe(true);
    expect(intent.inputArgs).toEqual(["alice"]);
  }
});

test("supports ignore-forks as a presence-only scan flag", () => {
  const intent = expectIntent(["dotfiles", "--ignore-forks", "alice"]);

  expect(intent.kind).toBe("scan");
  if (intent.kind === "scan") {
    expect(intent.ignoreForks).toBe(true);
    expect(intent.inputArgs).toEqual(["alice"]);
  }
});

test("rejects short flags, option terminator, and unknown long flags", () => {
  expect(expectErrors(["-h", "--", "--unknown"])).toEqual([
    "Unknown option: -h",
    "Unknown option: --",
    "Unknown option: --unknown",
  ]);
});

test("rejects equals values for presence-only flags while keeping following tokens as inputs", () => {
  expect(expectErrors(["--help=true", "--version=false", "--clear-cache=1", "--no-cache=false", "--verbose=false", "--ignore-forks=false"])).toEqual([
    "--help does not take a value.",
    "--version does not take a value.",
    "--clear-cache does not take a value.",
    "--no-cache does not take a value.",
    "--verbose does not take a value.",
    "--ignore-forks does not take a value.",
  ]);

  const intent = expectIntent(["dotfiles", "--no-cache", "alice"]);
  expect(intent.kind).toBe("scan");
  if (intent.kind === "scan") {
    expect(intent.inputArgs).toEqual(["alice"]);
    expect(intent.useCache).toBe(false);
  }
});

test("rejects exclusive commands mixed with scan flags or other exclusive commands", () => {
  expect(expectErrors(["--help", "dotfiles", "--format", "xml", "alice"])).toEqual([
    "--help cannot be combined with scan inputs or flags",
    "--format must be one of: json, csv",
  ]);
  expect(expectErrors(["--help", "--version"])).toEqual([
    "Only one exclusive command can be used: --help, --version, or --clear-cache",
  ]);
});

test("rejects duplicate scalar flags", () => {
  expect(expectErrors(["dotfiles", "--format", "json", "--format", "csv", "alice"])).toEqual(["Duplicate --format."]);
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
