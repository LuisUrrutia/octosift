import { FileCache } from "../cache/file-cache";
import type { GitHubCachePartition, GitHubListOptions } from "./client";

export interface GitHubCachePolicyOptions {
  cache?: FileCache;
  cachePartition?: GitHubCachePartition;
  ttlSeconds?: number;
}

const DEFAULT_TTL_SECONDS = 72 * 60 * 60;
const DEFAULT_CACHE_PARTITION: GitHubCachePartition = { kind: "rest-public" };
const USER_REPOS_PAYLOAD_SHAPE = "repository-list-v1";
const REPO_CONTRIBUTORS_PAYLOAD_SHAPE = "contributor-list-v1";

export class GitHubCachePolicy {
  private readonly cache: FileCache;
  private readonly cachePartition: GitHubCachePartition;
  private readonly ttlSeconds: number;

  constructor(options: GitHubCachePolicyOptions = {}) {
    this.cache = options.cache ?? new FileCache();
    this.cachePartition = options.cachePartition ?? DEFAULT_CACHE_PARTITION;
    this.ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  }

  async readUserRepos<T>(username: string, options: GitHubListOptions, load: () => Promise<readonly T[]>): Promise<readonly T[]> {
    return this.readThrough(userReposCacheKey(username, options, this.cachePartition), load);
  }

  async readRepoContributors<T>(owner: string, repo: string, options: GitHubListOptions, load: () => Promise<readonly T[]>): Promise<readonly T[]> {
    return this.readThrough(repoContributorsCacheKey(owner, repo, options, this.cachePartition), load);
  }

  private async readThrough<T>(key: string, load: () => Promise<readonly T[]>): Promise<readonly T[]> {
    const cached = await this.cache.read<readonly T[]>(key);

    if (cached.status === "hit") {
      return cached.value;
    }

    const value = await load();
    await this.cache.write(key, value, this.ttlSeconds);
    return value;
  }
}

export function defaultCacheTtlSeconds(): number {
  return DEFAULT_TTL_SECONDS;
}

export function userReposCacheKey(username: string, options: GitHubListOptions = {}, cachePartition: GitHubCachePartition = DEFAULT_CACHE_PARTITION): string {
  return stableCacheKey("user-repos", USER_REPOS_PAYLOAD_SHAPE, cachePartition, username, options);
}

export function repoContributorsCacheKey(owner: string, repo: string, options: GitHubListOptions = {}, cachePartition: GitHubCachePartition = DEFAULT_CACHE_PARTITION): string {
  return stableCacheKey("repo-contributors", REPO_CONTRIBUTORS_PAYLOAD_SHAPE, cachePartition, `${owner}/${repo}`, options);
}

function stableCacheKey(namespace: string, payloadShape: string, cachePartition: GitHubCachePartition, target: string, options: GitHubListOptions): string {
  return `${namespace}:${payloadShape}:${cachePartitionKey(cachePartition)}:${target}:${listOptionsKey(options)}`;
}

function normalizeListOptions(options: GitHubListOptions): GitHubListOptions {
  return options.perPage === undefined ? {} : { perPage: options.perPage };
}

function cachePartitionKey(cachePartition: GitHubCachePartition): string {
  return cachePartition.kind === "rest-token" ? `${cachePartition.kind}:${cachePartition.credentialIdentity}` : cachePartition.kind;
}

function listOptionsKey(options: GitHubListOptions): string {
  const normalized = normalizeListOptions(options);
  return normalized.perPage === undefined ? "default" : `perPage=${normalized.perPage}`;
}
