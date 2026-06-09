import { expect, test } from "bun:test";

import type { Contributor, NormalizedInput, RepoMetadata, SearchCandidate } from "../src/domain/types";
import { EXIT_CODE_PARTIAL_FAILURE, EXIT_CODE_RATE_LIMIT_EXHAUSTED, EXIT_CODE_SUCCESS } from "../src/domain/types";
import type { GitHubClient } from "../src/github/client";
import { GitHubClientError } from "../src/github/client";
import { createSearchIntentScorer } from "../src/rules/scoring";
import { scanInputs } from "../src/scan/index";
import { FakeGitHubClient, createFakeGitHubApiError } from "./fakes/fake-github-client";
import { cloneRepo, GITHUB_FIXTURE_REPOS } from "./fixtures/github";

test("scanner sequential call order applies maxRepos after user pagination order", async () => {
  const client = new FakeGitHubClient();
  const result = await scanInputs([userInput("alice"), repoInput("bob", "config")], client, { scorer: createSearchIntentScorer("dotfiles"), maxRepos: 2 });

  expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
  expect(client.callOrder.join(",")).toBe(
    "listUserRepos:alice,listRepoContributors:bob/config,listUserRepos:bob,listUserRepos:alice",
  );
  expect(result.candidates.map((candidate) => candidate.fullName).join(",")).toBe(
    "alice/dotfiles,alice/terminal-setup,bob/config,bob/old-dotfiles",
  );

  const aliceDotfiles = findCandidate(result.candidates, "alice/dotfiles");
  expect(aliceDotfiles.sourceUser.join(",")).toBe("alice");
  expect(aliceDotfiles.sourceInput.join(",")).toBe("alice,bob/config");
});

test("scanner expands repository contributors one hop and excludes bots", async () => {
  const client = new FakeGitHubClient();
  const result = await scanInputs([repoInput("alice", "dotfiles")], client, { scorer: createSearchIntentScorer("dotfiles") });

  expect(client.callOrder.join(",")).toBe("listRepoContributors:alice/dotfiles,listUserRepos:alice,listUserRepos:bob,listUserRepos:charlie");
  expect(client.callOrder.some((call) => call.includes("dependabot") || call.includes("renovate"))).toBe(false);
  expect(client.callOrder.some((call) => call.startsWith("listRepoContributors:") && call !== "listRepoContributors:alice/dotfiles")).toBe(false);

  const duplicate = findCandidate(result.candidates, "shared/shared-dotfiles");
  expect(duplicate.sourceUser.join(",")).toBe("alice,bob,charlie");
  expect(duplicate.sourceInput.join(",")).toBe("alice/dotfiles");
});

test("scanner excludes contributors matched by the shared bot policy", async () => {
  const client = new PatternBotContributorClient();
  const result = await scanInputs([repoInput("org", "project")], client, { scorer: createSearchIntentScorer("dotfiles") });

  expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
  expect(client.callOrder).toEqual(["listRepoContributors:org/project", "listUserRepos:alice"]);
  expect(result.candidates.map((candidate) => candidate.fullName)).toEqual(["alice/dotfiles"]);
});

test("scanner defaults maxContributors to 50 humans after bot filtering", async () => {
  const client = new ManyContributorsClient(55);
  const result = await scanInputs([repoInput("org", "project")], client, { scorer: createSearchIntentScorer("dotfiles") });

  expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
  expect(client.callOrder.length).toBe(51);
  expect(client.callOrder[0]).toBe("listRepoContributors:org/project");
  expect(client.callOrder[1]).toBe("listUserRepos:user-1");
  expect(client.callOrder[50]).toBe("listUserRepos:user-50");
  expect(client.callOrder.includes("listUserRepos:user-51")).toBe(false);
});

test("scanner dedupes candidates and merges source arrays deterministically", async () => {
  const client = new FakeGitHubClient();
  const result = await scanInputs([userInput("alice"), userInput("bob"), userInput("charlie")], client, { scorer: createSearchIntentScorer("dotfiles") });
  const shared = findCandidate(result.candidates, "shared/shared-dotfiles");

  expect(result.candidates.filter((candidate) => candidate.fullName === "shared/shared-dotfiles").length).toBe(1);
  expect(shared.sourceUser.join(",")).toBe("alice,bob,charlie");
  expect(shared.sourceInput.join(",")).toBe("alice,bob,charlie");
  expect(shared.score > 0).toBe(true);
  expect(shared.matchedSignals.length > 0).toBe(true);
});

test("scanner emits scored dotfiles candidates after ledger provenance merge", async () => {
  const client = new FakeGitHubClient();
  const result = await scanInputs([userInput("alice")], client, { scorer: createSearchIntentScorer("dotfiles") });
  const dotfiles = findCandidate(result.candidates, "alice/dotfiles");

  expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
  expect(dotfiles.score).toBe(18);
  expect(dotfiles.matchedSignals.map((signal) => signal.key)).toEqual(["dotfiles", "zsh", "stow", "macos", "linux"]);
  expect(dotfiles.sourceUser).toEqual(["alice"]);
  expect(dotfiles.sourceInput).toEqual(["alice"]);
});

test("scanner emits scored skills candidates after ledger provenance merge", async () => {
  const client = new MixedIntentClient();
  const result = await scanInputs([userInput("alice")], client, { scorer: createSearchIntentScorer("skills") });

  expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
  expect(client.callOrder).toEqual(["listUserRepos:alice"]);
  expect(result.candidates.map((candidate) => candidate.fullName)).toEqual(["alice/dotfiles", "alice/claude-skills"]);
  expect(findCandidate(result.candidates, "alice/dotfiles").score).toBe(0);
  expect(findCandidate(result.candidates, "alice/claude-skills").score).toBeGreaterThan(4);
  expect(findCandidate(result.candidates, "alice/claude-skills").matchedSignals.map((signal) => signal.key)).toEqual([
    "claude skills",
    "ai agent workflows",
    "agent skill",
    "claude skill",
  ]);
});

test("scanner duplicate discoveries merge provenance without replacing first-seen scoring snapshot", async () => {
  const client = new FakeGitHubClient();
  const result = await scanInputs([userInput("alice"), userInput("bob")], client, { scorer: createSearchIntentScorer("dotfiles") });
  const shared = findCandidate(result.candidates, "shared/shared-dotfiles");

  expect(shared.description).toBe("Shared dotfiles discovered through multiple users");
  expect(shared.topics).toEqual(["dotfiles", "shared"]);
  expect(shared.score).toBe(5);
  expect(shared.matchedSignals.map((signal) => signal.key)).toEqual(["dotfiles"]);
  expect(shared.sourceUser).toEqual(["alice", "bob"]);
  expect(shared.sourceInput).toEqual(["alice", "bob"]);
});

test("scanner ignores empty repositories from GitHub metadata", async () => {
  const client = new EmptyRepositoryClient();
  const result = await scanInputs([userInput("alice")], client, { scorer: createSearchIntentScorer("dotfiles") });

  expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
  expect(client.callOrder).toEqual(["listUserRepos:alice"]);
  expect(result.candidates.map((candidate) => candidate.fullName)).toEqual(["alice/dotfiles"]);
});

test("scanner partial failure warnings continue with usable candidates", async () => {
  const client = new FakeGitHubClient();
  client.queueFailure("listUserRepos", "bob", createFakeGitHubApiError(403, "bob forbidden"));

  const result = await scanInputs([userInput("alice"), userInput("bob"), userInput("charlie")], client, { scorer: createSearchIntentScorer("dotfiles") });

  expect(result.exitCode).toBe(EXIT_CODE_PARTIAL_FAILURE);
  expect(result.partialFailure).toBe(true);
  expect(result.warnings.length).toBe(1);
  expect(result.warnings[0].code).toBe("partial-failure");
  expect(result.warnings[0].input).toBe("bob");
  expect(result.warnings[0].contributor).toBe("bob");
  expect(result.candidates.map((candidate) => candidate.fullName).join(",")).toContain("alice/dotfiles");
  expect(result.candidates.map((candidate) => candidate.fullName).join(",")).toContain("charlie/workstation");
  expect(client.callOrder.join(",")).toBe("listUserRepos:alice,listUserRepos:bob,listUserRepos:charlie");
});

test("scanner maps rate-limit warnings to exit code 3 and stops", async () => {
  const client = new FakeGitHubClient();
  client.queueFailure("listUserRepos", "bob", createFakeGitHubApiError(429, "rate limited", 30));

  const result = await scanInputs([userInput("alice"), userInput("bob"), userInput("charlie")], client, { scorer: createSearchIntentScorer("dotfiles") });

  expect(result.exitCode).toBe(EXIT_CODE_RATE_LIMIT_EXHAUSTED);
  expect(result.partialFailure).toBe(true);
  expect(result.warnings[0].code).toBe("rate-limit");
  expect(result.warnings[0].retryAfterSeconds).toBe(30);
  expect(client.callOrder.join(",")).toBe("listUserRepos:alice,listUserRepos:bob");
  expect(result.candidates.map((candidate) => candidate.fullName).join(",")).toContain("alice/dotfiles");
});

test("scanner preserves structured GitHubClientError rate-limit context", async () => {
  const client = new StructuredFailureClient();
  const result = await scanInputs([repoInput("org", "private")], client, { scorer: createSearchIntentScorer("dotfiles") });

  expect(result.exitCode).toBe(EXIT_CODE_RATE_LIMIT_EXHAUSTED);
  expect(JSON.stringify(result.warnings[0])).toBe(JSON.stringify({
    code: "rate-limit",
    message: "secondary rate limit",
    input: "org/private",
    repository: "org/private",
    retryAfterSeconds: 45,
  }));
});

function userInput(login: string): NormalizedInput {
  return {
    kind: "user",
    login,
    url: `https://github.com/${login}`,
  };
}

function repoInput(owner: string, name: string): NormalizedInput {
  return {
    kind: "repository",
    owner,
    name,
    fullName: `${owner}/${name}`,
    url: `https://github.com/${owner}/${name}`,
  };
}

function findCandidate(candidates: readonly SearchCandidate[], fullName: string): SearchCandidate {
  const candidate = candidates.find((item) => item.fullName === fullName);

  if (candidate === undefined) {
    throw new Error(`missing candidate ${fullName}`);
  }

  return candidate;
}

class ManyContributorsClient implements GitHubClient {
  readonly callOrder: string[] = [];

  constructor(private readonly humanCount: number) {}

  async listRepoContributors(owner: string, repo: string): Promise<readonly Contributor[]> {
    this.callOrder.push(`listRepoContributors:${owner}/${repo}`);
    const contributors: Contributor[] = [{ login: "dependabot[bot]", url: "https://github.com/apps/dependabot", contributions: 1, isBot: true }];

    for (let index = 1; index <= this.humanCount; index += 1) {
      contributors.push({ login: `user-${index}`, url: `https://github.com/user-${index}`, contributions: index, isBot: false });
    }

    return contributors;
  }

  async listUserRepos(username: string): Promise<readonly RepoMetadata[]> {
    this.callOrder.push(`listUserRepos:${username}`);
    return [{ ...cloneRepo(GITHUB_FIXTURE_REPOS[0]), owner: username, fullName: `${username}/dotfiles`, url: `https://github.com/${username}/dotfiles` }];
  }
}

class PatternBotContributorClient implements GitHubClient {
  readonly callOrder: string[] = [];

  async listRepoContributors(owner: string, repo: string): Promise<readonly Contributor[]> {
    this.callOrder.push(`listRepoContributors:${owner}/${repo}`);
    return [
      { login: "renovate", url: "https://github.com/renovate", contributions: 8, isBot: false },
      { login: "alice", url: "https://github.com/alice", contributions: 3, isBot: false },
    ];
  }

  async listUserRepos(username: string): Promise<readonly RepoMetadata[]> {
    this.callOrder.push(`listUserRepos:${username}`);
    return [{ ...cloneRepo(GITHUB_FIXTURE_REPOS[0]), owner: username, fullName: `${username}/dotfiles`, url: `https://github.com/${username}/dotfiles` }];
  }
}

class MixedIntentClient implements GitHubClient {
  readonly callOrder: string[] = [];

  async listRepoContributors(): Promise<readonly Contributor[]> {
    return [];
  }

  async listUserRepos(username: string): Promise<readonly RepoMetadata[]> {
    this.callOrder.push(`listUserRepos:${username}`);
    return [
      cloneRepo(GITHUB_FIXTURE_REPOS[0]),
      {
        ...cloneRepo(GITHUB_FIXTURE_REPOS[0]),
        name: "claude-skills",
        fullName: `${username}/claude-skills`,
        url: `https://github.com/${username}/claude-skills`,
        description: "Reusable Claude skills for AI agent workflows",
        topics: ["agent-skill"],
      },
    ];
  }
}

class EmptyRepositoryClient implements GitHubClient {
  readonly callOrder: string[] = [];

  async listRepoContributors(): Promise<readonly Contributor[]> {
    return [];
  }

  async listUserRepos(username: string): Promise<readonly RepoMetadata[]> {
    this.callOrder.push(`listUserRepos:${username}`);

    return [
      {
        ...cloneRepo(GITHUB_FIXTURE_REPOS[0]),
        name: "empty-dotfiles",
        fullName: `${username}/empty-dotfiles`,
        url: `https://github.com/${username}/empty-dotfiles`,
        size: 0,
      },
      {
        ...cloneRepo(GITHUB_FIXTURE_REPOS[0]),
        owner: username,
        fullName: `${username}/dotfiles`,
        url: `https://github.com/${username}/dotfiles`,
        size: 32,
      },
    ];
  }
}

class StructuredFailureClient implements GitHubClient {
  async listUserRepos(): Promise<readonly RepoMetadata[]> {
    return [];
  }

  async listRepoContributors(): Promise<readonly Contributor[]> {
    throw new GitHubClientError({ kind: "rate-limit", message: "secondary rate limit", retryAfterSeconds: 45 });
  }
}
