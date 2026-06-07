import { FileCache } from "../cache/file-cache";
import { CachedGitHubClient } from "../github/cached-client";
import type { SelectedGitHubClient } from "../github/client";

export interface RuntimePolicy {
  useCache: boolean;
  cacheTtlSeconds: number;
}

export interface RuntimeDependencies {
  createDefaultGitHubClient(): Promise<SelectedGitHubClient>;
  createFileCache(): FileCache;
}

export async function prepareRuntime(policy: RuntimePolicy, dependencies: RuntimeDependencies): Promise<SelectedGitHubClient> {
  const selectedClient = await dependencies.createDefaultGitHubClient();
  const client = policy.useCache
    ? new CachedGitHubClient(selectedClient.client, {
      cache: dependencies.createFileCache(),
      cachePartition: selectedClient.cachePartition,
      ttlSeconds: policy.cacheTtlSeconds,
    })
    : selectedClient.client;

  return { ...selectedClient, client };
}
