import type { Contributor, RateLimitInfo, RepoMetadata, ScanWarning } from "../domain/types";

export interface GitHubListOptions {
  perPage?: number;
}

export interface GitHubClient {
  listUserRepos(username: string, options?: GitHubListOptions): Promise<readonly RepoMetadata[]>;
  listRepoContributors(owner: string, repo: string, options?: GitHubListOptions): Promise<readonly Contributor[]>;
}

export type GitHubClientKind = "gh" | "rest-token" | "rest-public";

export type GitHubCachePartition =
  | { kind: "gh" }
  | { kind: "rest-token"; credentialIdentity: string }
  | { kind: "rest-public" };

export interface SelectedGitHubClient {
  kind: GitHubClientKind;
  cachePartition: GitHubCachePartition;
  client: GitHubClient;
  warnings: readonly ScanWarning[];
}

export type GitHubErrorKind = "forbidden" | "partial" | "rate-limit";

export interface GitHubClientErrorOptions {
  kind: GitHubErrorKind;
  message: string;
  status?: number;
  endpoint?: string;
  retryAfterSeconds?: number;
  rateLimit?: RateLimitInfo;
  cause?: unknown;
}

export class GitHubClientError extends Error {
  readonly kind: GitHubErrorKind;
  readonly status?: number;
  readonly endpoint?: string;
  readonly retryAfterSeconds?: number;
  readonly rateLimit?: RateLimitInfo;
  override readonly cause?: unknown;

  constructor(options: GitHubClientErrorOptions) {
    super(options.message);
    this.name = "GitHubClientError";
    this.kind = options.kind;
    this.status = options.status;
    this.endpoint = options.endpoint;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.rateLimit = options.rateLimit;
    this.cause = options.cause;
  }
}

export function createUnauthenticatedRestWarning(): ScanWarning {
  return {
    code: "partial-failure",
    message: "Using unauthenticated GitHub REST API; rate limits will be lower.",
  };
}
