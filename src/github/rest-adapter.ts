import type { Contributor, RateLimitInfo, RepoMetadata } from "../domain/types";
import { GitHubClientError, type GitHubClient, type GitHubListOptions } from "./client";
import { mapGitHubContributor, mapGitHubRepo } from "./response-mapping";

export type GitHubFetch = (input: string, init: { headers: Record<string, string> }) => Promise<Response>;

export interface RestGitHubClientOptions {
  fetch?: GitHubFetch;
  token?: string;
  baseUrl?: string;
}

type GitHubRepoResponse = Parameters<typeof mapGitHubRepo>[0];
type GitHubContributorResponse = Parameters<typeof mapGitHubContributor>[0];

export class RestGitHubClient implements GitHubClient {
  private readonly fetchImpl: GitHubFetch;
  private readonly token?: string;
  private readonly baseUrl: string;

  constructor(options: RestGitHubClientOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.token = options.token;
    this.baseUrl = options.baseUrl ?? "https://api.github.com";
  }

  async listUserRepos(username: string, options: GitHubListOptions = {}): Promise<readonly RepoMetadata[]> {
    const path = `/users/${username}/repos`;
    const repos = await this.fetchPages<GitHubRepoResponse>(path, options.perPage);
    return repos.map(mapGitHubRepo);
  }

  async listRepoContributors(owner: string, repo: string, options: GitHubListOptions = {}): Promise<readonly Contributor[]> {
    const path = `/repos/${owner}/${repo}/contributors`;
    const contributors = await this.fetchPages<GitHubContributorResponse>(path, options.perPage);
    return contributors.map(mapGitHubContributor);
  }

  private async fetchPages<T>(path: string, perPage = 100): Promise<T[]> {
    const allItems: T[] = [];
    let nextUrl: string | undefined = this.buildInitialUrl(path, perPage);

    while (nextUrl !== undefined) {
      const response = await this.fetchImpl(nextUrl, { headers: this.headers() });
      await assertOk(response, path);
      const page = (await response.json()) as unknown;

      if (!Array.isArray(page)) {
        throw new GitHubClientError({ kind: "partial", endpoint: path, message: `GitHub REST returned a non-array response for ${path}` });
      }

      allItems.push(...(page as T[]));
      nextUrl = parseNextLink(response.headers.get("link"));
    }

    return allItems;
  }

  private buildInitialUrl(path: string, perPage: number): string {
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.set("per_page", String(perPage));
    return url.toString();
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };

    if (this.token !== undefined && this.token.length > 0) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    return headers;
  }
}

async function assertOk(response: Response, endpoint: string): Promise<void> {
  if (response.ok) {
    return;
  }

  const retryAfterSeconds = parseIntegerHeader(response.headers.get("retry-after"));
  const rateLimit = readRateLimit(response.headers);
  const kind = isRateLimited(response.status, retryAfterSeconds, rateLimit) ? "rate-limit" : response.status === 403 ? "forbidden" : "partial";

  throw new GitHubClientError({
    kind,
    status: response.status,
    endpoint,
    retryAfterSeconds,
    rateLimit,
    message: await responseMessage(response, endpoint),
  });
}

async function responseMessage(response: Response, endpoint: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === "string" && body.message.length > 0) {
      return body.message;
    }
  } catch {
    return `GitHub REST request failed for ${endpoint} with status ${response.status}`;
  }

  return `GitHub REST request failed for ${endpoint} with status ${response.status}`;
}

function isRateLimited(status: number, retryAfterSeconds: number | undefined, rateLimit: RateLimitInfo | undefined): boolean {
  return status === 429 || retryAfterSeconds !== undefined || (status === 403 && rateLimit?.remaining === 0);
}

function readRateLimit(headers: Headers): RateLimitInfo | undefined {
  const remaining = parseIntegerHeader(headers.get("x-ratelimit-remaining"));
  const limit = parseIntegerHeader(headers.get("x-ratelimit-limit"));
  const resetSeconds = parseIntegerHeader(headers.get("x-ratelimit-reset"));

  if (remaining === undefined || limit === undefined || resetSeconds === undefined) {
    return undefined;
  }

  return {
    remaining,
    limit,
    resetAt: new Date(resetSeconds * 1000).toISOString(),
  };
}

function parseIntegerHeader(value: string | null): number | undefined {
  if (value === null || value.trim() === "") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function parseNextLink(link: string | null): string | undefined {
  if (link === null) {
    return undefined;
  }

  for (const part of link.split(",")) {
    const [urlPart, ...parameters] = part.trim().split(";").map((piece) => piece.trim());
    if (parameters.includes('rel="next"') && urlPart.startsWith("<") && urlPart.endsWith(">")) {
      return urlPart.slice(1, -1);
    }
  }

  return undefined;
}
