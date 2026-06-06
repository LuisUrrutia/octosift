import type { Contributor, RepoMetadata } from "../domain/types";
import { GitHubClientError, type GitHubClient, type GitHubListOptions } from "./client";
import { mapGitHubContributor, mapGitHubRepo } from "./response-mapping";

export interface GhCommand {
  command: string;
  args: readonly string[];
  env: Record<string, string>;
}

export interface GhCommandResult {
  stdout: string;
  stderr?: string;
  status?: number;
}

export type GhCommandRunner = (command: GhCommand) => Promise<GhCommandResult>;

export interface GhGitHubClientOptions {
  run: GhCommandRunner;
  env?: Record<string, string | undefined>;
}

type GitHubRepoResponse = Parameters<typeof mapGitHubRepo>[0];
type GitHubContributorResponse = Parameters<typeof mapGitHubContributor>[0];

export class GhGitHubClient implements GitHubClient {
  private readonly run: GhCommandRunner;
  private readonly env: Record<string, string | undefined>;

  constructor(options: GhGitHubClientOptions) {
    this.run = options.run;
    this.env = options.env ?? {};
  }

  async listUserRepos(username: string, options: GitHubListOptions = {}): Promise<readonly RepoMetadata[]> {
    const endpoint = `/users/${username}/repos`;
    const result = await this.callApi(endpoint, options.perPage);
    return parseJsonArray<GitHubRepoResponse>(result.stdout, endpoint).map(mapGitHubRepo);
  }

  async listRepoContributors(owner: string, repo: string, options: GitHubListOptions = {}): Promise<readonly Contributor[]> {
    const endpoint = `/repos/${owner}/${repo}/contributors`;
    const result = await this.callApi(endpoint, options.perPage);
    return parseJsonArray<GitHubContributorResponse>(result.stdout, endpoint).map(mapGitHubContributor);
  }

  private async callApi(endpoint: string, perPage = 100): Promise<GhCommandResult> {
    try {
      const result = await this.run({
        command: "gh",
        args: ["api", endpoint, "--method", "GET", "-F", `per_page=${perPage}`, "--paginate"],
        env: {
          ...definedEnv(this.env),
          GH_PROMPT_DISABLED: "1",
        },
      });

      if (result.status !== undefined && result.status !== 0) {
        throw mapGhApiFailure({ endpoint, stdout: result.stdout, stderr: result.stderr, status: result.status });
      }

      return result;
    } catch (error) {
      if (error instanceof GitHubClientError) {
        throw error;
      }

      throw mapGhApiFailure({ endpoint, error });
    }
  }
}

interface GhApiFailureContext {
  endpoint: string;
  stdout?: string;
  stderr?: string;
  status?: number;
  error?: unknown;
}

function mapGhApiFailure(context: GhApiFailureContext): GitHubClientError {
  const text = [context.stderr, context.stdout, errorMessage(context.error)].filter((part) => part !== undefined && part.length > 0).join("\n");
  const parsedHttpStatus = parseHttpStatus(text);
  const status = parsedHttpStatus ?? (context.status === 403 || context.status === 429 ? context.status : undefined);
  const retryAfterSeconds = parseRetryAfterSeconds(text);

  if (isGhRateLimitFailure(text, status, retryAfterSeconds)) {
    return new GitHubClientError({
      kind: "rate-limit",
      endpoint: context.endpoint,
      status,
      retryAfterSeconds,
      message: ghFailureMessage(text, context.endpoint, status),
      cause: context.error,
    });
  }

  return new GitHubClientError({
    kind: status === 403 ? "forbidden" : "partial",
    endpoint: context.endpoint,
    status,
    message: ghFailureMessage(text, context.endpoint, status),
    cause: context.error,
  });
}

function errorMessage(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" ? error : undefined;
}

function parseHttpStatus(text: string): number | undefined {
  const match = /(?:HTTP|status)\D+(403|429)\b/i.exec(text);
  if (match === null) {
    return undefined;
  }

  return Number(match[1]);
}

function parseRetryAfterSeconds(text: string): number | undefined {
  const match = /retry-after\D+(\d+)/i.exec(text) ?? /retry after\D+(\d+)/i.exec(text);
  if (match === null) {
    return undefined;
  }

  return Number(match[1]);
}

function isGhRateLimitFailure(text: string, status: number | undefined, retryAfterSeconds: number | undefined): boolean {
  const normalized = text.toLowerCase();
  return status === 429 || retryAfterSeconds !== undefined || normalized.includes("rate limit") || normalized.includes("rate-limit");
}

function ghFailureMessage(text: string, endpoint: string, status: number | undefined): string {
  const firstLine = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (firstLine !== undefined) {
    return firstLine;
  }

  if (status !== undefined) {
    return `gh api request failed for ${endpoint} with status ${status}`;
  }

  return `gh api request failed for ${endpoint}`;
}

function definedEnv(env: Record<string, string | undefined>): Record<string, string> {
  const next: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      next[key] = value;
    }
  }

  return next;
}

function parseJsonArray<T>(stdout: string, endpoint: string): T[] {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    if (Array.isArray(parsed)) {
      return parsed as T[];
    }
  } catch {
    return parseConcatenatedJsonArrays<T>(stdout, endpoint);
  }

  throw new GitHubClientError({ kind: "partial", endpoint, message: `gh returned a non-array response for ${endpoint}` });
}

function parseConcatenatedJsonArrays<T>(stdout: string, endpoint: string): T[] {
  const pages: T[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = -1;

  for (let index = 0; index < stdout.length; index += 1) {
    const character = stdout[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === "[" || character === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
    } else if (character === "]" || character === "}") {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        const parsed = JSON.parse(stdout.slice(start, index + 1)) as unknown;
        if (!Array.isArray(parsed)) {
          throw new GitHubClientError({ kind: "partial", endpoint, message: `gh returned a non-array page for ${endpoint}` });
        }
        pages.push(...(parsed as T[]));
        start = -1;
      }
    }
  }

  if (pages.length > 0 && depth === 0) {
    return pages;
  }

  throw new GitHubClientError({ kind: "partial", endpoint, message: `gh returned invalid JSON for ${endpoint}` });
}
