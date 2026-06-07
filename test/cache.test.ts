import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "bun:test";

import { FileCache, safeCacheKey } from "../src/cache/file-cache";
import { CachedGitHubClient, defaultCacheTtlSeconds, repoContributorsCacheKey, userReposCacheKey } from "../src/github/cached-client";
import type { GitHubCachePartition } from "../src/github/client";
import { FakeGitHubClient } from "./fakes/fake-github-client";

test("FileCache misses, hits fresh envelopes, treats stale envelopes as stale, and clears files", async () => {
  const baseDir = await tempCacheDir();
  let now = 1_000;
  const cache = new FileCache({ baseDir, now: () => now });
  const key = "user-repos:{alice}";

  expect(await cache.read<string>(key)).toEqual({ status: "miss" });

  await cache.write(key, "cached", 10);
  expect(await cache.read<string>(key)).toMatchObject({ status: "hit", value: "cached" });

  now = 11_001;
  expect(await cache.read<string>(key)).toMatchObject({ status: "stale" });

  await cache.clear();
  expect(await cache.read<string>(key)).toEqual({ status: "miss" });
});

test("cache keys separate user repositories from repository contributors and stay path-safe", () => {
  const userKey = userReposCacheKey("owner/repo", { perPage: 100 });
  const contributorsKey = repoContributorsCacheKey("owner", "repo", { perPage: 100 });

  expect(userKey).not.toBe(contributorsKey);
  expect(userKey).toBe(userReposCacheKey("owner/repo", { perPage: 100 }));
  expect(safeCacheKey(contributorsKey)).toMatch(/^[a-f0-9]+$/);
});

test("cache keys include selected GitHub client mode and credential identity without raw tokens", () => {
  const publicPartition: GitHubCachePartition = { kind: "rest-public" };
  const firstTokenPartition: GitHubCachePartition = { kind: "rest-token", credentialIdentity: "GH_TOKEN:sha256:first-fingerprint" };
  const secondTokenPartition: GitHubCachePartition = { kind: "rest-token", credentialIdentity: "GH_TOKEN:sha256:second-fingerprint" };

  const publicKey = userReposCacheKey("alice", { perPage: 100 }, publicPartition);
  const firstTokenKey = userReposCacheKey("alice", { perPage: 100 }, firstTokenPartition);
  const secondTokenKey = userReposCacheKey("alice", { perPage: 100 }, secondTokenPartition);

  expect(publicKey).not.toBe(firstTokenKey);
  expect(firstTokenKey).not.toBe(secondTokenKey);
  expect(firstTokenKey.includes("ghp_raw_secret_token")).toBe(false);
});

test("CachedGitHubClient serves fresh user repo cache hits without touching the inner client", async () => {
  const baseDir = await tempCacheDir();
  const cache = new FileCache({ baseDir, now: () => 1_000 });
  const firstInner = new FakeGitHubClient();
  const firstClient = new CachedGitHubClient(firstInner, { cache, ttlSeconds: 60 });

  const firstRepos = await firstClient.listUserRepos("alice", { perPage: 100 });
  expect(firstRepos.length).toBeGreaterThan(0);
  expect(firstInner.callOrder).toEqual(["listUserRepos:alice"]);

  const secondInner = new FakeGitHubClient();
  const secondClient = new CachedGitHubClient(secondInner, { cache, ttlSeconds: 60 });
  const secondRepos = await secondClient.listUserRepos("alice", { perPage: 100 });

  expect(secondRepos.map((repo) => repo.fullName)).toEqual(firstRepos.map((repo) => repo.fullName));
  expect(secondInner.callOrder).toEqual([]);
});

test("CachedGitHubClient partitions read-through cache by selected GitHub client mode", async () => {
  const baseDir = await tempCacheDir();
  const cache = new FileCache({ baseDir, now: () => 1_000 });
  const ghInner = new FakeGitHubClient();
  const ghClient = new CachedGitHubClient(ghInner, { cache, ttlSeconds: 60, cachePartition: { kind: "gh" } });

  await ghClient.listUserRepos("alice", { perPage: 100 });
  expect(ghInner.callOrder).toEqual(["listUserRepos:alice"]);

  const publicInner = new FakeGitHubClient();
  const publicClient = new CachedGitHubClient(publicInner, { cache, ttlSeconds: 60, cachePartition: { kind: "rest-public" } });
  await publicClient.listUserRepos("alice", { perPage: 100 });

  expect(publicInner.callOrder).toEqual(["listUserRepos:alice"]);
});

test("CachedGitHubClient partitions token-backed REST cache by credential identity", async () => {
  const baseDir = await tempCacheDir();
  const cache = new FileCache({ baseDir, now: () => 1_000 });
  const firstInner = new FakeGitHubClient();
  const firstClient = new CachedGitHubClient(firstInner, {
    cache,
    ttlSeconds: 60,
    cachePartition: { kind: "rest-token", credentialIdentity: "GH_TOKEN:sha256:first" },
  });

  await firstClient.listUserRepos("alice", { perPage: 100 });
  expect(firstInner.callOrder).toEqual(["listUserRepos:alice"]);

  const secondInner = new FakeGitHubClient();
  const secondClient = new CachedGitHubClient(secondInner, {
    cache,
    ttlSeconds: 60,
    cachePartition: { kind: "rest-token", credentialIdentity: "GH_TOKEN:sha256:second" },
  });
  await secondClient.listUserRepos("alice", { perPage: 100 });

  expect(secondInner.callOrder).toEqual(["listUserRepos:alice"]);
});

test("CachedGitHubClient writes GitHub responses with the default cache TTL", async () => {
  const baseDir = await tempCacheDir();
  const cache = new FileCache({ baseDir, now: () => 1_000 });
  const inner = new FakeGitHubClient();
  const client = new CachedGitHubClient(inner, { cache });

  await client.listUserRepos("alice", { perPage: 100 });

  const cached = await cache.read(userReposCacheKey("alice", { perPage: 100 }));
  expect(cached.status).toBe("hit");
  if (cached.status !== "hit") {
    throw new Error("expected fresh cached GitHub response");
  }
  expect(cached.envelope.ttlSeconds).toBe(defaultCacheTtlSeconds());
});

test("CachedGitHubClient refreshes stale contributor cache entries and overwrites them", async () => {
  const baseDir = await tempCacheDir();
  let now = 1_000;
  const cache = new FileCache({ baseDir, now: () => now });
  const firstInner = new FakeGitHubClient();
  const firstClient = new CachedGitHubClient(firstInner, { cache, ttlSeconds: 1 });

  await firstClient.listRepoContributors("shared", "shared-dotfiles", { perPage: 100 });
  expect(firstInner.callOrder).toEqual(["listRepoContributors:shared/shared-dotfiles"]);

  now = 2_001;
  const secondInner = new FakeGitHubClient();
  const secondClient = new CachedGitHubClient(secondInner, { cache, ttlSeconds: 1 });
  await secondClient.listRepoContributors("shared", "shared-dotfiles", { perPage: 100 });

  expect(secondInner.callOrder).toEqual(["listRepoContributors:shared/shared-dotfiles"]);
  const text = await Bun.file(join(baseDir, `${safeCacheKey(repoContributorsCacheKey("shared", "shared-dotfiles", { perPage: 100 }))}.json`)).text();
  expect(JSON.parse(text)).toMatchObject({ fetchedAt: 2_001, ttlSeconds: 1 });
});

async function tempCacheDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "dotfiles-finder-cache-test-"));
}
