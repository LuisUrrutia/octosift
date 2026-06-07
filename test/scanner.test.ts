import { expect, test } from "bun:test";

import type { Contributor, DotfilesCandidate, NormalizedInput, RepoMetadata } from "../src/domain/types";
import { EXIT_CODE_PARTIAL_FAILURE, EXIT_CODE_RATE_LIMIT_EXHAUSTED, EXIT_CODE_SUCCESS } from "../src/domain/types";
import type { GitHubClient } from "../src/github/client";
import { GitHubClientError } from "../src/github/client";
import { scanInputs } from "../src/scan/index";
import { FakeGitHubClient, createFakeGitHubApiError } from "./fakes/fake-github-client";
import { cloneRepo, GITHUB_FIXTURE_REPOS } from "./fixtures/github";

test("scanner sequential call order applies maxRepos after user pagination order", async () => {
  const client = new FakeGitHubClient();
  const result = await scanInputs([userInput("alice"), repoInput("bob", "config")], client, { maxRepos: 2 });

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
  const result = await scanInputs([repoInput("alice", "dotfiles")], client);

  expect(client.callOrder.join(",")).toBe("listRepoContributors:alice/dotfiles,listUserRepos:alice,listUserRepos:bob,listUserRepos:charlie");
  expect(client.callOrder.some((call) => call.includes("dependabot") || call.includes("renovate"))).toBe(false);
  expect(client.callOrder.some((call) => call.startsWith("listRepoContributors:") && call !== "listRepoContributors:alice/dotfiles")).toBe(false);

  const duplicate = findCandidate(result.candidates, "shared/shared-dotfiles");
  expect(duplicate.sourceUser.join(",")).toBe("alice,bob,charlie");
  expect(duplicate.sourceInput.join(",")).toBe("alice/dotfiles");
});

test("scanner defaults maxContributors to 50 humans after bot filtering", async () => {
  const client = new ManyContributorsClient(55);
  const result = await scanInputs([repoInput("org", "project")], client);

  expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
  expect(client.callOrder.length).toBe(51);
  expect(client.callOrder[0]).toBe("listRepoContributors:org/project");
  expect(client.callOrder[1]).toBe("listUserRepos:user-1");
  expect(client.callOrder[50]).toBe("listUserRepos:user-50");
  expect(client.callOrder.includes("listUserRepos:user-51")).toBe(false);
});

test("scanner dedupes candidates and merges source arrays deterministically", async () => {
  const client = new FakeGitHubClient();
  const result = await scanInputs([userInput("alice"), userInput("bob"), userInput("charlie")], client);
  const shared = findCandidate(result.candidates, "shared/shared-dotfiles");

  expect(result.candidates.filter((candidate) => candidate.fullName === "shared/shared-dotfiles").length).toBe(1);
  expect(shared.sourceUser.join(",")).toBe("alice,bob,charlie");
  expect(shared.sourceInput.join(",")).toBe("alice,bob,charlie");
  expect(shared.score > 0).toBe(true);
  expect(shared.matchedSignals.length > 0).toBe(true);
});

test("scanner partial failure warnings continue with usable candidates", async () => {
  const client = new FakeGitHubClient();
  client.queueFailure("listUserRepos", "bob", createFakeGitHubApiError(403, "bob forbidden"));

  const result = await scanInputs([userInput("alice"), userInput("bob"), userInput("charlie")], client);

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

  const result = await scanInputs([userInput("alice"), userInput("bob"), userInput("charlie")], client);

  expect(result.exitCode).toBe(EXIT_CODE_RATE_LIMIT_EXHAUSTED);
  expect(result.partialFailure).toBe(true);
  expect(result.warnings[0].code).toBe("rate-limit");
  expect(result.warnings[0].retryAfterSeconds).toBe(30);
  expect(client.callOrder.join(",")).toBe("listUserRepos:alice,listUserRepos:bob");
  expect(result.candidates.map((candidate) => candidate.fullName).join(",")).toContain("alice/dotfiles");
});

test("scanner preserves structured GitHubClientError rate-limit context", async () => {
  const client = new StructuredFailureClient();
  const result = await scanInputs([repoInput("org", "private")], client);

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

function findCandidate(candidates: readonly DotfilesCandidate[], fullName: string): DotfilesCandidate {
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

class StructuredFailureClient implements GitHubClient {
  async listUserRepos(): Promise<readonly RepoMetadata[]> {
    return [];
  }

  async listRepoContributors(): Promise<readonly Contributor[]> {
    throw new GitHubClientError({ kind: "rate-limit", message: "secondary rate limit", retryAfterSeconds: 45 });
  }
}
