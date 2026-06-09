import type { Contributor, RepoMetadata } from "../domain/types";
import { isBotContributor } from "../rules/bots";

interface GitHubRepoResponse {
  name: string;
  full_name: string;
  html_url: string;
  description?: string | null;
  topics?: unknown;
  stargazers_count: number;
  forks_count: number;
  size: number;
  language?: string | null;
  fork: boolean;
  archived: boolean;
  updated_at?: string | null;
  pushed_at?: string | null;
  owner: { login: string };
}

interface GitHubContributorResponse {
  login: string;
  html_url: string;
  contributions: number;
  type?: string | null;
}

export function mapGitHubRepo(repo: GitHubRepoResponse): RepoMetadata {
  return {
    owner: repo.owner.login,
    name: repo.name,
    fullName: repo.full_name,
    url: repo.html_url,
    description: repo.description ?? null,
    topics: Array.isArray(repo.topics) ? repo.topics : [],
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    size: repo.size,
    language: repo.language ?? null,
    isFork: repo.fork,
    isArchived: repo.archived,
    updatedAt: repo.updated_at ?? null,
    pushedAt: repo.pushed_at ?? null,
  };
}

export function mapGitHubContributor(contributor: GitHubContributorResponse): Contributor {
  return {
    login: contributor.login,
    url: contributor.html_url,
    contributions: contributor.contributions,
    isBot: isBotContributor(contributor),
  };
}
