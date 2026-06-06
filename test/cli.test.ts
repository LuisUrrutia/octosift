import { mkdtemp } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "bun:test";

import { FileCache } from "../src/cache/file-cache";
import { runCli } from "../src/cli/index";
import { EXIT_CODE_PARTIAL_FAILURE, EXIT_CODE_RATE_LIMIT_EXHAUSTED, EXIT_CODE_SUCCESS, type ScanResult, type ScanWarning } from "../src/domain/types";
import { scanInputs } from "../src/scan/scanner";
import { FakeGitHubClient, createFakeGitHubApiError } from "./fakes/fake-github-client";

test("prints expanded help without selecting a GitHub client", async () => {
  const io = createIo();
  const exitCode = await runCli(["--help"], io.writers, {
    createDefaultGitHubClient: async () => {
      throw new Error("GitHub should not be touched for help");
    },
  });

  expect(exitCode).toBe(0);
  expect(io.stdout.join("\n")).toContain("--format <json|csv>");
  expect(io.stdout.join("\n")).toContain("@path");
  expect(io.stdout.join("\n")).toContain("--max-repos <n>");
  expect(io.stderr.join("\n")).toBe("");
});


test("help documents cache flags without selecting a GitHub client", async () => {
  const io = createIo();
  const exitCode = await runCli(["--help"], io.writers, {
    createDefaultGitHubClient: async () => {
      throw new Error("GitHub should not be touched for help");
    },
  });

  expect(exitCode).toBe(0);
  expect(io.stdout.join("\n")).toContain("--no-cache");
  expect(io.stdout.join("\n")).toContain("--cache-ttl <seconds>");
  expect(io.stdout.join("\n")).toContain("--clear-cache");
  expect(io.stdout.join("\n")).toContain("--help");
  expect(io.stdout.join("\n").includes("--help, -h")).toBe(false);
  expect(io.stdout.join("\n").includes("--version, -v")).toBe(false);
  expect(io.stdout.join("\n")).toContain("exclusive");
  expect(io.stderr.join("\n")).toBe("");
});

test("caches GitHub API responses by default across CLI runs", async () => {
  const cacheDir = await tempCacheDir();
  const firstIo = createIo();
  const firstClient = new FakeGitHubClient();
  const firstExit = await runCli(["alice"], firstIo.writers, fakeDependencies(firstClient, [], cacheDir));

  const secondIo = createIo();
  const secondClient = new FakeGitHubClient();
  const secondExit = await runCli(["alice"], secondIo.writers, fakeDependencies(secondClient, [], cacheDir));

  expect(firstExit).toBe(EXIT_CODE_SUCCESS);
  expect(secondExit).toBe(EXIT_CODE_SUCCESS);
  expect(firstClient.callOrder).toEqual(["listUserRepos:alice"]);
  expect(secondClient.callOrder).toEqual([]);
  expect(JSON.parse(secondIo.stdout.join("\n")).length).toBeGreaterThan(0);
});

test("--no-cache bypasses the persistent GitHub API cache", async () => {
  const cacheDir = await tempCacheDir();
  const firstIo = createIo();
  const firstClient = new FakeGitHubClient();
  await runCli(["--no-cache", "alice"], firstIo.writers, fakeDependencies(firstClient, [], cacheDir));

  const secondIo = createIo();
  const secondClient = new FakeGitHubClient();
  await runCli(["--no-cache", "alice"], secondIo.writers, fakeDependencies(secondClient, [], cacheDir));

  expect(firstClient.callOrder).toEqual(["listUserRepos:alice"]);
  expect(secondClient.callOrder).toEqual(["listUserRepos:alice"]);
});

test("--cache-ttl accepts zero and refreshes every run", async () => {
  const cacheDir = await tempCacheDir();
  const firstIo = createIo();
  const firstClient = new FakeGitHubClient();
  await runCli(["--cache-ttl", "0", "alice"], firstIo.writers, fakeDependencies(firstClient, [], cacheDir));

  const secondIo = createIo();
  const secondClient = new FakeGitHubClient();
  await runCli(["--cache-ttl", "0", "alice"], secondIo.writers, fakeDependencies(secondClient, [], cacheDir));

  expect(firstClient.callOrder).toEqual(["listUserRepos:alice"]);
  expect(secondClient.callOrder).toEqual(["listUserRepos:alice"]);
});

test("rejects invalid --cache-ttl values", async () => {
  const io = createIo();
  const exitCode = await runCli(["--cache-ttl", "1.5", "alice"], io.writers, fakeDependencies(new FakeGitHubClient()));

  expect(exitCode).toBe(1);
  expect(io.stdout.join("\n")).toBe("");
  expect(io.stderr.join("\n")).toContain("Invalid --cache-ttl value: 1.5");
});

test("--clear-cache clears cache and exits before selecting a GitHub client or scanning", async () => {
  const cacheDir = await tempCacheDir();
  const cache = new FileCache({ baseDir: cacheDir });
  await cache.write("user-repos:alice", [{ fullName: "alice/dotfiles" }], 60);
  const io = createIo();
  let scanned = false;

  const exitCode = await runCli(["--clear-cache"], io.writers, {
    createFileCache: () => cache,
    createDefaultGitHubClient: async () => {
      throw new Error("GitHub should not be touched for clear-cache");
    },
    scanInputs: async () => {
      scanned = true;
      return emptyScanResult(0);
    },
  });

  expect(exitCode).toBe(0);
  expect(scanned).toBe(false);
  expect(io.stdout.join("\n")).toBe("");
  expect(io.stderr.join("\n")).toBe("");
  expect(await cache.read("user-repos:alice")).toEqual({ status: "miss" });
});

test("prints version without selecting a GitHub client", async () => {
  const io = createIo();
  const exitCode = await runCli(["--version"], io.writers, {
    createDefaultGitHubClient: async () => {
      throw new Error("GitHub should not be touched for version");
    },
  });

  expect(exitCode).toBe(0);
  expect(io.stdout.join("\n")).toBe("0.0.0");
  expect(io.stderr.join("\n")).toBe("");
});

test("rejects exclusive commands mixed with scan inputs before selecting a GitHub client", async () => {
  const io = createIo();
  const exitCode = await runCli(["--help", "alice"], io.writers, {
    createDefaultGitHubClient: async () => {
      throw new Error("GitHub should not be touched after parse errors");
    },
  });

  expect(exitCode).toBe(1);
  expect(io.stdout.join("\n")).toBe("");
  expect(io.stderr.join("\n")).toContain("--help cannot be combined with scan inputs or flags");
});

test("rejects short aliases as unknown options", async () => {
  const io = createIo();
  const exitCode = await runCli(["-h"], io.writers, {
    createDefaultGitHubClient: async () => {
      throw new Error("GitHub should not be touched after parse errors");
    },
  });

  expect(exitCode).toBe(1);
  expect(io.stdout.join("\n")).toBe("");
  expect(io.stderr.join("\n")).toContain("Unknown option: -h");
});

test("valid scan flags without inputs still reach input normalization", async () => {
  const io = createIo();
  const seenArgs: readonly string[][] = [];
  const exitCode = await runCli(["--format", "csv"], io.writers, {
    normalizeInputs: async (args) => {
      (seenArgs as string[][]).push([...args]);
      return { inputs: [], errors: [] };
    },
    createDefaultGitHubClient: async () => {
      throw new Error("GitHub should not be touched after empty normalized inputs");
    },
  });

  expect(exitCode).toBe(1);
  expect(seenArgs[0]).toEqual([]);
  expect(io.stdout.join("\n")).toBe("");
  expect(io.stderr.join("\n")).toContain("At least one GitHub user, repository, URL, or input file is required.");
});

test("scans a user and writes JSON by default", async () => {
  const io = createIo();
  const client = new FakeGitHubClient();
  const exitCode = await runCli(["alice"], io.writers, fakeDependencies(client));

  expect(exitCode).toBe(EXIT_CODE_SUCCESS);
  expect(io.stderr.join("\n")).toBe("");
  const output = JSON.parse(io.stdout.join("\n")) as { fullName: string; score: number }[];
  expect(output.map((candidate) => candidate.fullName).join(",")).toBe("alice/dotfiles,alice/terminal-setup,shared/shared-dotfiles");
  expect(output.every((candidate) => candidate.score >= 3)).toBe(true);
  expect(client.callOrder.join(",")).toBe("listUserRepos:alice");
});

test("routes CSV format and keeps warnings off stdout", async () => {
  const io = createIo();
  const client = new FakeGitHubClient();
  const exitCode = await runCli(["--format", "csv", "alice"], io.writers, fakeDependencies(client));

  expect(exitCode).toBe(EXIT_CODE_SUCCESS);
  expect(io.stdout[0].startsWith("url,owner,name,fullName,description,topics")).toBe(true);
  expect(io.stdout.join("\n")).toContain("https://github.com/alice/dotfiles");
  expect(io.stderr.join("\n")).toBe("");
});

test("passes --file and @path through normalizeInputs", async () => {
  const io = createIo();
  const seenArgs: readonly string[][] = [];
  const exitCode = await runCli(["--file", "inputs.txt", "@more.txt"], io.writers, {
    normalizeInputs: async (args) => {
      (seenArgs as string[][]).push([...args]);
      return {
        inputs: [{ kind: "user", login: "alice", url: "https://github.com/alice" }],
        errors: [],
      };
    },
    createDefaultGitHubClient: async () => ({ kind: "rest-token", client: new FakeGitHubClient(), warnings: [] }),
    scanInputs: async () => emptyScanResult(0),
  });

  expect(exitCode).toBe(0);
  expect(JSON.stringify(seenArgs[0])).toBe(JSON.stringify(["--file", "inputs.txt", "@more.txt"]));
  expect(io.stdout.join("\n")).toBe("[]");
  expect(io.stderr.join("\n")).toBe("");
});

test("rejects invalid format and numeric flags with exit 1 and empty stdout", async () => {
  const invalidFormat = createIo();
  const invalidFormatExit = await runCli(["--format", "xml", "alice"], invalidFormat.writers, fakeDependencies(new FakeGitHubClient()));
  const invalidNumber = createIo();
  const invalidNumberExit = await runCli(["--max-repos", "0", "alice"], invalidNumber.writers, fakeDependencies(new FakeGitHubClient()));

  expect(invalidFormatExit).toBe(1);
  expect(invalidFormat.stdout.join("\n")).toBe("");
  expect(invalidFormat.stderr.join("\n")).toContain("--format must be one of: json, csv");
  expect(invalidNumberExit).toBe(1);
  expect(invalidNumber.stdout.join("\n")).toBe("");
  expect(invalidNumber.stderr.join("\n")).toContain("Invalid --max-repos value: 0");
});

test("normalizer errors exit 1 before selecting a GitHub client", async () => {
  const io = createIo();
  const exitCode = await runCli(["bad/input/value"], io.writers, {
    normalizeInputs: async () => ({
      inputs: [],
      errors: [{ code: "invalid-input", input: "bad/input/value", message: "Invalid GitHub input: bad/input/value" }],
    }),
    createDefaultGitHubClient: async () => {
      throw new Error("GitHub should not be touched after input errors");
    },
  });

  expect(exitCode).toBe(1);
  expect(io.stdout.join("\n")).toBe("");
  expect(io.stderr.join("\n")).toContain("Invalid GitHub input: bad/input/value");
});

test("client selection warnings go to stderr while stdout stays valid JSON", async () => {
  const io = createIo();
  const warning: ScanWarning = { code: "partial-failure", message: "Using unauthenticated GitHub REST API; rate limits will be lower." };
  const exitCode = await runCli(["alice"], io.writers, fakeDependencies(new FakeGitHubClient(), [warning]));

  expect(exitCode).toBe(0);
  expect(Array.isArray(JSON.parse(io.stdout.join("\n")))).toBe(true);
  expect(io.stderr.join("\n")).toContain("unauthenticated GitHub REST API");
});

test("partial scanner warnings map to exit 2 with usable JSON", async () => {
  const io = createIo();
  const client = new FakeGitHubClient();
  client.queueFailure("listUserRepos", "bob", createFakeGitHubApiError(403, "bob forbidden"));

  const exitCode = await runCli(["alice", "bob"], io.writers, fakeDependencies(client));
  const output = JSON.parse(io.stdout.join("\n")) as { fullName: string }[];

  expect(exitCode).toBe(EXIT_CODE_PARTIAL_FAILURE);
  expect(output.map((candidate) => candidate.fullName).join(",")).toContain("alice/dotfiles");
  expect(io.stderr.join("\n")).toContain("partial-failure: bob forbidden");
});

test("rate-limit scanner warnings map to exit 3 with valid partial JSON", async () => {
  const io = createIo();
  const client = new FakeGitHubClient();
  client.queueFailure("listUserRepos", "bob", createFakeGitHubApiError(429, "rate limited", 30));

  const exitCode = await runCli(["alice", "bob", "charlie"], io.writers, fakeDependencies(client));
  const output = JSON.parse(io.stdout.join("\n")) as { fullName: string }[];

  expect(exitCode).toBe(EXIT_CODE_RATE_LIMIT_EXHAUSTED);
  expect(output.map((candidate) => candidate.fullName).join(",")).toContain("alice/dotfiles");
  expect(client.callOrder.join(",")).toBe("listUserRepos:alice,listUserRepos:bob");
  expect(io.stderr.join("\n")).toContain("rate-limit: rate limited");
  expect(io.stderr.join("\n")).toContain("retry-after=30s");
});

function createIo(): { stdout: string[]; stderr: string[]; writers: { stdout(value: string): void; stderr(value: string): void } } {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    stdout,
    stderr,
    writers: {
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value),
    },
  };
}

function fakeDependencies(client: FakeGitHubClient, warnings: readonly ScanWarning[] = [], cacheDir = mkdtempSync(join(tmpdir(), "dotfiles-finder-cli-cache-test-"))) {
  return {
    createDefaultGitHubClient: async () => ({ kind: "rest-token" as const, client, warnings }),
    createFileCache: () => new FileCache({ baseDir: cacheDir }),
    scanInputs,
  };
}

async function tempCacheDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "dotfiles-finder-cli-cache-test-"));
}

function emptyScanResult(exitCode: 0): ScanResult {
  return {
    candidates: [],
    warnings: [],
    partialFailure: false,
    exitCode,
  };
}
