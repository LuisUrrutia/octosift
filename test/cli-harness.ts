import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FileCache } from "../src/cache/file-cache";
import { runCli, type CliDependencies, type CliWriters } from "../src/cli/index";
import { expandCliInputArgs, type ExpandCliInputArgsOptions } from "../src/cli/input-expansion";
import type { ExitCode, ScanResult, ScanWarning, SearchCandidate } from "../src/domain/types";
import type { GitHubCachePartition, GitHubClientKind } from "../src/github/client";
import { normalizeInputs } from "../src/input/normalize";
import { scanInputs } from "../src/scan/index";
import { FakeGitHubClient } from "./fakes/fake-github-client";

export interface CapturedCliIo {
  stdout: string[];
  stderr: string[];
  writers: CliWriters;
}

export interface FakeCliDependenciesOptions {
  kind?: GitHubClientKind;
  warnings?: readonly ScanWarning[];
  cacheDir?: string;
  expandInputOptions?: ExpandCliInputArgsOptions;
}

export interface RunCliForTestOptions extends FakeCliDependenciesOptions {
  client?: FakeGitHubClient;
  dependencies?: Partial<CliDependencies>;
}

export interface CliRunResult {
  exitCode: ExitCode;
  stdout: string[];
  stderr: string[];
  client: FakeGitHubClient;
}

export function createCliIo(): CapturedCliIo {
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

export async function runCliForTest(args: string[], options: RunCliForTestOptions = {}): Promise<CliRunResult> {
  const io = createCliIo();
  const client = options.client ?? new FakeGitHubClient();
  const dependencies = options.dependencies ?? createFakeCliDependencies(client, options);
  const exitCode = await runCli(args, io.writers, dependencies);

  return {
    exitCode,
    stdout: io.stdout,
    stderr: io.stderr,
    client,
  };
}

export function createFakeCliDependencies(client: FakeGitHubClient, options: FakeCliDependenciesOptions = {}): Partial<CliDependencies> {
  const kind = options.kind ?? "rest-token";
  const cacheDir = options.cacheDir ?? createTempCliCacheDir();

  return {
    expandInputArgs: (args: readonly string[]) => expandCliInputArgs(args, options.expandInputOptions ?? {}),
    normalizeInputs,
    createDefaultGitHubClient: async () => ({
      kind,
      cachePartition: cachePartitionFor(kind),
      client,
      warnings: options.warnings ?? [],
    }),
    createFileCache: () => new FileCache({ baseDir: cacheDir }),
    scanInputs,
  };
}

export function createTempCliCacheDir(prefix = "octosift-cli-cache-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function parseJsonOutput(stdout: readonly string[]): SearchCandidate[] {
  return JSON.parse(stdout.join("\n")) as SearchCandidate[];
}

export function fileReader(files: ReadonlyMap<string, string>): (path: string) => string {
  return (path: string) => {
    const value = files.get(path);

    if (value === undefined) {
      throw new Error(`Missing fake file: ${path}`);
    }

    return value;
  };
}

export function emptyScanResult(exitCode: 0): ScanResult {
  return {
    candidates: [],
    warnings: [],
    partialFailure: false,
    exitCode,
  };
}

function cachePartitionFor(kind: GitHubClientKind): GitHubCachePartition {
  if (kind === "rest-token") {
    return { kind: "rest-token", credentialIdentity: "test-token:sha256:stable" };
  }

  if (kind === "rest-public") {
    return { kind: "rest-public" };
  }

  return { kind: "gh" };
}
