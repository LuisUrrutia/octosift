import { expect, test } from "bun:test";

import * as responseMapping from "../src/github/response-mapping";
import { mapGitHubContributor, mapGitHubRepo } from "../src/github/response-mapping";

const repoJson = {
  name: "dotfiles",
  full_name: "alice/dotfiles",
  html_url: "https://github.com/alice/dotfiles",
  description: null,
  topics: ["dotfiles", "stow"],
  stargazers_count: 42,
  forks_count: 7,
  language: null,
  fork: false,
  archived: false,
  updated_at: "2026-05-25T10:00:00Z",
  pushed_at: null,
  owner: { login: "alice" },
};

test("maps GitHub repository responses to domain metadata", () => {
  const repo = mapGitHubRepo(repoJson);

  expect(repo).toEqual({
    owner: "alice",
    name: "dotfiles",
    fullName: "alice/dotfiles",
    url: "https://github.com/alice/dotfiles",
    description: null,
    topics: ["dotfiles", "stow"],
    stars: 42,
    forks: 7,
    language: null,
    isFork: false,
    isArchived: false,
    updatedAt: "2026-05-25T10:00:00Z",
    pushedAt: null,
  });
});

test("keeps current loose repository default mapping", () => {
  const repo = mapGitHubRepo({
    ...repoJson,
    description: undefined,
    topics: "dotfiles",
    language: undefined,
    updated_at: undefined,
    pushed_at: undefined,
  });

  expect(repo.description).toBe(null);
  expect(repo.topics).toEqual([]);
  expect(repo.language).toBe(null);
  expect(repo.updatedAt).toBe(null);
  expect(repo.pushedAt).toBe(null);
});

test("maps GitHub contributor responses with response-level bot classification", () => {
  expect(mapGitHubContributor({ login: "alice", html_url: "https://github.com/alice", contributions: 12, type: "User" })).toEqual({
    login: "alice",
    url: "https://github.com/alice",
    contributions: 12,
    isBot: false,
  });

  expect(mapGitHubContributor({ login: "github-actions", html_url: "https://github.com/actions", contributions: 3, type: "Bot" }).isBot).toBe(true);
  expect(mapGitHubContributor({ login: "dependabot[bot]", html_url: "https://github.com/apps/dependabot", contributions: 4, type: "User" }).isBot).toBe(true);
});

test("keeps response mapping dependency direction narrow", async () => {
  const source = await Bun.file(new URL("../src/github/response-mapping.ts", import.meta.url).pathname).text();

  expect(Object.keys(responseMapping).sort()).toEqual(["mapGitHubContributor", "mapGitHubRepo"]);
  expect(source.includes("../domain/types")).toBe(true);
  expect(source.includes("./client")).toBe(false);
  expect(source.includes("./gh-adapter")).toBe(false);
  expect(source.includes("./rest-adapter")).toBe(false);
});
