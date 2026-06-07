import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "bun:test";

import { FileCache } from "../src/cache/file-cache";
import { runCli } from "../src/cli/index";
import {
  EXIT_CODE_PARTIAL_FAILURE,
  EXIT_CODE_RATE_LIMIT_EXHAUSTED,
  EXIT_CODE_SUCCESS,
  type DotfilesCandidate,
  type ScanWarning,
} from "../src/domain/types";
import { normalizeInputs, type NormalizeInputsOptions } from "../src/input/normalize";
import { scanInputs } from "../src/scan/index";
import { FakeGitHubClient, createFakeGitHubApiError } from "./fakes/fake-github-client";

test("json default scans user input with real scanner and no live client", async () => {
  const client = new FakeGitHubClient();
  const io = createIo();

  const exitCode = await runCli(["alice"], io.writers, fakeDependencies(client));
  const output = parseJsonOutput(io.stdout);

  expect(exitCode).toBe(EXIT_CODE_SUCCESS);
  expect(io.stderr.join("\n")).toBe("");
  expect(JSON.stringify(output.map((candidate) => candidate.fullName))).toBe(JSON.stringify(["alice/dotfiles", "alice/terminal-setup", "shared/shared-dotfiles"]));
  expect(output.every((candidate) => candidate.score >= 3)).toBe(true);
  expect(JSON.stringify(client.callOrder)).toBe(JSON.stringify(["listUserRepos:alice"]));
});

test("repo input expands contributors one hop and excludes bots", async () => {
  const client = new FakeGitHubClient();
  const io = createIo();

  const exitCode = await runCli(["alice/dotfiles"], io.writers, fakeDependencies(client));
  const output = parseJsonOutput(io.stdout);

  expect(exitCode).toBe(EXIT_CODE_SUCCESS);
  expect(output.map((candidate) => candidate.fullName)).toContain("bob/old-dotfiles");
  expect(output.flatMap((candidate) => candidate.sourceUser).includes("dependabot[bot]")).toBe(false);
  expect(output.flatMap((candidate) => candidate.sourceUser).includes("renovate[bot]")).toBe(false);
  expect(JSON.stringify(client.callOrder)).toBe(JSON.stringify([
    "listRepoContributors:alice/dotfiles",
    "listUserRepos:alice",
    "listUserRepos:bob",
    "listUserRepos:charlie",
  ]));
});

test("mixed file input uses real normalizer and merges duplicate JSON sources", async () => {
  const client = new FakeGitHubClient();
  const io = createIo();
  const files = new Map([
    [
      "inputs.txt",
      [
        "# comments are ignored",
        "alice",
        "https://github.com/bob",
        "alice",
        "https://github.com/charlie/workstation/issues",
      ].join("\n"),
    ],
  ]);

  const exitCode = await runCli(["--file", "inputs.txt", "bob"], io.writers, fakeDependencies(client, [], { readFile: fileReader(files) }));
  const output = parseJsonOutput(io.stdout);
  const shared = output.find((candidate) => candidate.fullName === "shared/shared-dotfiles");

  expect(exitCode).toBe(EXIT_CODE_SUCCESS);
  expect(JSON.stringify(shared?.sourceUser)).toBe(JSON.stringify(["alice", "bob", "charlie"]));
  expect(JSON.stringify(shared?.sourceInput)).toBe(JSON.stringify(["alice", "bob", "charlie/workstation"]));
  expect(JSON.stringify(client.callOrder)).toBe(JSON.stringify([
    "listUserRepos:alice",
    "listUserRepos:bob",
    "listRepoContributors:charlie/workstation",
    "listUserRepos:charlie",
  ]));
});

test("csv output remains machine-readable and keeps warnings on stderr", async () => {
  const client = new FakeGitHubClient();
  const io = createIo();
  const warnings: ScanWarning[] = [{ code: "partial-failure", message: "Using fake client warning." }];

  const exitCode = await runCli(["--format", "csv", "alice"], io.writers, fakeDependencies(client, warnings));
  const stdout = io.stdout.join("\n");

  expect(exitCode).toBe(EXIT_CODE_SUCCESS);
  expect(stdout.startsWith("url,owner,name,fullName,description,topics,stars,forks,language,isFork,isArchived,updatedAt,pushedAt,matchedSignals,score,sourceUser,sourceInput\n")).toBe(true);
  expect(stdout).toContain("https://github.com/alice/dotfiles,alice,dotfiles,alice/dotfiles");
  expect(stdout).toContain("dotfiles;stow;zsh");
  expect(io.stderr.join("\n")).toContain("Using fake client warning.");
  expect(JSON.stringify(client.callOrder)).toBe(JSON.stringify(["listUserRepos:alice"]));
});

test("max contributor cap limits repo expansion through sequential call order", async () => {
  const client = new FakeGitHubClient();
  const io = createIo();

  const exitCode = await runCli(["--max-contributors", "2", "alice/dotfiles"], io.writers, fakeDependencies(client));
  const output = parseJsonOutput(io.stdout);

  expect(exitCode).toBe(EXIT_CODE_SUCCESS);
  expect(output.map((candidate) => candidate.fullName).includes("charlie/workstation")).toBe(false);
  expect(JSON.stringify(client.callOrder)).toBe(JSON.stringify([
    "listRepoContributors:alice/dotfiles",
    "listUserRepos:alice",
    "listUserRepos:bob",
  ]));
});

test("max repo cap limits emitted candidates without batching", async () => {
  const client = new FakeGitHubClient();
  const io = createIo();

  const exitCode = await runCli(["--min-score", "0", "--max-repos", "1", "alice", "bob"], io.writers, fakeDependencies(client));
  const output = parseJsonOutput(io.stdout);

  expect(exitCode).toBe(EXIT_CODE_SUCCESS);
  expect(JSON.stringify(output.map((candidate) => candidate.fullName))).toBe(JSON.stringify(["alice/dotfiles", "bob/config"]));
  expect(JSON.stringify(client.callOrder)).toBe(JSON.stringify(["listUserRepos:alice", "listUserRepos:bob"]));
});

test("partial failure exits 2 with usable json and stderr warning", async () => {
  const client = new FakeGitHubClient();
  const io = createIo();
  client.queueFailure("listUserRepos", "bob", createFakeGitHubApiError(403, "bob forbidden"));

  const exitCode = await runCli(["alice", "bob", "charlie"], io.writers, fakeDependencies(client));
  const output = parseJsonOutput(io.stdout);

  expect(exitCode).toBe(EXIT_CODE_PARTIAL_FAILURE);
  expect(output.map((candidate) => candidate.fullName)).toContain("alice/dotfiles");
  expect(io.stderr.join("\n")).toContain("partial-failure: bob forbidden");
  expect(JSON.stringify(client.callOrder)).toBe(JSON.stringify(["listUserRepos:alice", "listUserRepos:bob", "listUserRepos:charlie"]));
});

test("rate limit failure exits 3, stops later inputs, and emits valid empty json", async () => {
  const client = new FakeGitHubClient();
  const io = createIo();
  client.queueFailure("listUserRepos", "bob", createFakeGitHubApiError(429, "rate limited", 30));

  const exitCode = await runCli(["bob", "alice"], io.writers, fakeDependencies(client));
  const output = parseJsonOutput(io.stdout);

  expect(exitCode).toBe(EXIT_CODE_RATE_LIMIT_EXHAUSTED);
  expect(JSON.stringify(output)).toBe(JSON.stringify([]));
  expect(io.stderr.join("\n")).toContain("rate-limit: rate limited");
  expect(io.stderr.join("\n")).toContain("retry-after=30s");
  expect(JSON.stringify(client.callOrder)).toBe(JSON.stringify(["listUserRepos:bob"]));
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

function fakeDependencies(client: FakeGitHubClient, warnings: readonly ScanWarning[] = [], options: NormalizeInputsOptions = {}) {
  const cacheDir = mkdtempSync(join(tmpdir(), "dotfiles-finder-e2e-cache-test-"));

  return {
    normalizeInputs: (args: readonly string[]) => normalizeInputs(args, options),
    createDefaultGitHubClient: async () => ({ kind: "rest-token" as const, client, warnings }),
    createFileCache: () => new FileCache({ baseDir: cacheDir }),
    scanInputs,
  };
}

function parseJsonOutput(stdout: readonly string[]): DotfilesCandidate[] {
  return JSON.parse(stdout.join("\n")) as DotfilesCandidate[];
}

function fileReader(files: ReadonlyMap<string, string>): (path: string) => string {
  return (path: string) => {
    const value = files.get(path);

    if (value === undefined) {
      throw new Error(`Missing fake file: ${path}`);
    }

    return value;
  };
}
