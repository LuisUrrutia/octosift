import type { Contributor, RepoMetadata } from "../../src/domain/types";
import type { GitHubClient, GitHubListOptions } from "../../src/github/client";
import { cloneContributor, cloneRepo, GITHUB_FIXTURE_CONTRIBUTORS, GITHUB_FIXTURE_USER_REPOS } from "../fixtures/github";

export interface FakeGitHubApiError extends Error {
  status: 403 | 429;
  retryAfterSeconds?: number;
  remaining?: number;
}

export interface FakeGitHubClientCall {
  method: "listUserRepos" | "listRepoContributors";
  target: string;
  options: GitHubListOptions;
}

interface QueuedFailure {
  method: FakeGitHubClientCall["method"];
  target: string;
  error: FakeGitHubApiError;
}

export class FakeGitHubClient implements GitHubClient {
  readonly callOrder: string[] = [];
  readonly calls: FakeGitHubClientCall[] = [];

  private readonly failures: QueuedFailure[] = [];

  queueFailure(method: QueuedFailure["method"], target: string, error: FakeGitHubApiError): void {
    this.failures.push({ method, target, error });
  }

  async listUserRepos(username: string, options: GitHubListOptions = {}): Promise<readonly RepoMetadata[]> {
    this.recordCall("listUserRepos", username, options);
    this.throwQueuedFailure("listUserRepos", username);

    const repos = GITHUB_FIXTURE_USER_REPOS[username] ?? [];
    return repos.map(cloneRepo);
  }

  async listRepoContributors(owner: string, repo: string, options: GitHubListOptions = {}): Promise<readonly Contributor[]> {
    const target = `${owner}/${repo}`;
    this.recordCall("listRepoContributors", target, options);
    this.throwQueuedFailure("listRepoContributors", target);

    const contributors = GITHUB_FIXTURE_CONTRIBUTORS[target] ?? [];
    return contributors.map(cloneContributor);
  }

  private recordCall(method: FakeGitHubClientCall["method"], target: string, options: GitHubListOptions): void {
    this.callOrder.push(`${method}:${target}`);
    this.calls.push({ method, target, options });
  }

  private throwQueuedFailure(method: QueuedFailure["method"], target: string): void {
    const index = this.failures.findIndex((failure) => failure.method === method && failure.target === target);

    if (index === -1) {
      return;
    }

    const [failure] = this.failures.splice(index, 1);
    throw failure.error;
  }
}

export function createFakeGitHubApiError(status: 403 | 429, message: string, retryAfterSeconds?: number): FakeGitHubApiError {
  const error = new Error(message) as FakeGitHubApiError;
  error.status = status;

  if (retryAfterSeconds !== undefined) {
    error.retryAfterSeconds = retryAfterSeconds;
    error.remaining = 0;
  }

  return error;
}
