import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";

import { EXIT_CODE_INVALID_INPUT } from "../src/domain/types";
import { loadSearchIntentCatalog } from "../src/rules/search-intent-catalog";
import { runCli } from "../src/cli/index";
import { createCliIo, createFakeCliDependencies, parseJsonOutput } from "./cli-harness";
import { FakeGitHubClient } from "./fakes/fake-github-client";

test("default missing or empty config directory keeps built-in definitions", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "octosift-catalog-default-"));
  const previousCwd = process.cwd();
  process.chdir(tempDir);
  try {
    const missingCatalog = await loadSearchIntentCatalog();
    await mkdir(join(tempDir, "config"));
    const emptyCatalog = await loadSearchIntentCatalog();

    expect(missingCatalog.intentNames).toEqual(["dotfiles", "skills"]);
    expect(emptyCatalog.intentNames).toEqual(["dotfiles", "skills"]);
    expect(emptyCatalog.resolve("dotfiles")?.score(repo({ name: "dotfiles" })).score).toBe(10);
  } finally {
    process.chdir(previousCwd);
  }
});

test("loads TOML intent definitions lexicographically and replaces same-name definitions whole", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "octosift-catalog-config-"));
  await Bun.write(join(configDir, "20-replace.toml"), [
    "[[intent]]",
    'name = "homebrew"',
    'normalization = "lowercase"',
    "",
    "[[intent.exact_name]]",
    'name = "brewfiles"',
    "score = 8",
    'label = "replacement exact name"',
  ].join("\n"));
  await Bun.write(join(configDir, "10-first.toml"), [
    "[[intent]]",
    'name = "homebrew"',
    'normalization = "lowercase-separators"',
    "",
    "[[intent.term_group]]",
    'label = "brew term"',
    "score = 4",
    'terms = ["home brew"]',
    'fields = ["name", "description", "topics"]',
  ].join("\n"));

  const catalog = await loadSearchIntentCatalog({ configDir });
  const scorer = catalog.resolve("homebrew");

  expect(catalog.intentNames).toEqual(["dotfiles", "skills", "homebrew"]);
  expect(scorer?.score(repo({ name: "home-brew", description: "home brew package manager" })).score).toBe(0);
  expect(scorer?.score(repo({ name: "brewfiles" })).matchedSignals).toEqual([
    { key: "brewfiles", label: "replacement exact name", score: 8, evidence: 'name exactly "brewfiles"' },
  ]);
});

test("invalid TOML and invalid definition shapes fail instead of being skipped", async () => {
  const invalidTomlDir = await mkdtemp(join(tmpdir(), "octosift-invalid-toml-"));
  await Bun.write(join(invalidTomlDir, "broken.toml"), "[[intent]\nname =");

  await expectRejects(loadSearchIntentCatalog({ configDir: invalidTomlDir }), "Invalid TOML");

  const invalidShapeDir = await mkdtemp(join(tmpdir(), "octosift-invalid-shape-"));
  await Bun.write(join(invalidShapeDir, "broken.toml"), [
    "[[intent]]",
    'name = "broken"',
    "",
    "[[intent.term_group]]",
    'label = "bad"',
    "score = 1",
    'terms = ["bad"]',
    'fields = ["stars"]',
  ].join("\n"));

  await expectRejects(loadSearchIntentCatalog({ configDir: invalidShapeDir }), "unsupported field");
});

test("invalid command-unsafe intent names fail catalog validation", async () => {
  const invalidNameDir = await mkdtemp(join(tmpdir(), "octosift-invalid-name-"));
  await Bun.write(join(invalidNameDir, "broken.toml"), [
    "[[intent]]",
    'name = "bad intent"',
    "",
    "[[intent.term_group]]",
    'label = "bad"',
    "score = 1",
    'terms = ["bad"]',
    'fields = ["name"]',
  ].join("\n"));

  await expectRejects(loadSearchIntentCatalog({ configDir: invalidNameDir }), "command-safe token");
});

test("explicit missing config directory exits invalid before selecting GitHub runtime", async () => {
  const io = createCliIo();
  const missingDir = join(tmpdir(), "octosift-missing-config-dir");
  let selectedClient = false;
  let expandedInputs = false;

  const exitCode = await runCli(["dotfiles", "--config-dir", missingDir, "alice"], io.writers, {
    ...createFakeCliDependencies(new FakeGitHubClient()),
    expandInputArgs: async () => {
      expandedInputs = true;
      throw new Error("Inputs should not be expanded after config errors");
    },
    createDefaultGitHubClient: async () => {
      selectedClient = true;
      throw new Error("GitHub should not be selected after config errors");
    },
  });

  expect(exitCode).toBe(EXIT_CODE_INVALID_INPUT);
  expect(expandedInputs).toBe(false);
  expect(selectedClient).toBe(false);
  expect(io.stdout.join("\n")).toBe("");
  expect(io.stderr.join("\n")).toContain("Config directory not found");
});

test("CLI scans with user-defined TOML intent after catalog resolution", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "octosift-cli-config-"));
  await mkdir(join(configDir, "nested"));
  await Bun.write(join(configDir, "intent.toml"), [
    "[[intent]]",
    'name = "workstations"',
    'normalization = "lowercase"',
    "",
    "[[intent.term_group]]",
    'label = "workstation metadata"',
    "score = 6",
    'terms = ["terminal", "workstation"]',
    'fields = ["name", "description", "topics"]',
    "",
    "[intent.penalties]",
    "fork = -1",
    "archived = -2",
  ].join("\n"));
  const io = createCliIo();
  const client = new FakeGitHubClient();

  const exitCode = await runCli(["workstations", "--config-dir", configDir, "alice"], io.writers, createFakeCliDependencies(client));
  const output = parseJsonOutput(io.stdout);

  expect(exitCode).toBe(0);
  expect(output.map((candidate) => candidate.fullName)).toEqual(["alice/terminal-setup"]);
  expect(client.callOrder).toEqual(["listUserRepos:alice"]);
});

test("unknown intent is rejected after catalog resolution", async () => {
  const io = createCliIo();
  let selectedClient = false;

  const exitCode = await runCli(["unknown", "alice"], io.writers, {
    ...createFakeCliDependencies(new FakeGitHubClient()),
    createDefaultGitHubClient: async () => {
      selectedClient = true;
      throw new Error("GitHub should not be selected for unknown intent");
    },
  });

  expect(exitCode).toBe(EXIT_CODE_INVALID_INPUT);
  expect(selectedClient).toBe(false);
  expect(io.stderr.join("\n")).toContain("Unknown search intent: unknown");
});

function repo(overrides: { name: string; description?: string; topics?: readonly string[] }) {
  return {
    owner: "alice",
    name: overrides.name,
    fullName: `alice/${overrides.name}`,
    url: `https://github.com/alice/${overrides.name}`,
    description: overrides.description ?? null,
    topics: overrides.topics ?? [],
    stars: 0,
    forks: 0,
    size: 1,
    language: null,
    isFork: false,
    isArchived: false,
    updatedAt: null,
    pushedAt: null,
  };
}

async function expectRejects(promise: Promise<unknown>, expectedMessage: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(error instanceof Error ? error.message : String(error)).toContain(expectedMessage);
    return;
  }

  throw new Error(`Expected rejection containing ${expectedMessage}`);
}
