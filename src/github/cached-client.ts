import type { Contributor, RepoMetadata } from "../domain/types";
import type { GitHubCachePartition, GitHubClient, GitHubListOptions } from "./client";
import { FileCache } from "../cache/file-cache";
import { GitHubCachePolicy } from "./cache-policy";

export { defaultCacheTtlSeconds, repoContributorsCacheKey, userReposCacheKey } from "./cache-policy";

export interface CachedGitHubClientOptions {
  cache?: FileCache;
  cachePartition?: GitHubCachePartition;
  ttlSeconds?: number;
}

export class CachedGitHubClient implements GitHubClient {
  private readonly inner: GitHubClient;
  private readonly cachePolicy: GitHubCachePolicy;

  constructor(inner: GitHubClient, options: CachedGitHubClientOptions = {}) {
    this.inner = inner;
    this.cachePolicy = new GitHubCachePolicy(options);
  }

  async listUserRepos(username: string, options: GitHubListOptions = {}): Promise<readonly RepoMetadata[]> {
    return this.cachePolicy.readUserRepos(username, options, () => this.inner.listUserRepos(username, options));
  }

  async listRepoContributors(owner: string, repo: string, options: GitHubListOptions = {}): Promise<readonly Contributor[]> {
    return this.cachePolicy.readRepoContributors(owner, repo, options, () => this.inner.listRepoContributors(owner, repo, options));
  }
}
