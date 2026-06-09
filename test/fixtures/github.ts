import type { Contributor, RepoMetadata } from "../../src/domain/types";

export interface GitHubUserFixture {
  login: string;
  name: string;
  url: string;
  isBot: boolean;
}

export const GITHUB_FIXTURE_USERS: readonly GitHubUserFixture[] = [
  { login: "alice", name: "Alice Carter", url: "https://github.com/alice", isBot: false },
  { login: "bob", name: "Bob Nguyen", url: "https://github.com/bob", isBot: false },
  { login: "charlie", name: "Charlie Rivera", url: "https://github.com/charlie", isBot: false },
  { login: "dependabot[bot]", name: "Dependabot", url: "https://github.com/apps/dependabot", isBot: true },
  { login: "renovate[bot]", name: "Renovate", url: "https://github.com/apps/renovate", isBot: true },
  { login: "github-actions[bot]", name: "GitHub Actions", url: "https://github.com/apps/github-actions", isBot: true },
  { login: "claude[bot]", name: "Claude", url: "https://github.com/apps/claude", isBot: true },
  { login: "copilot[bot]", name: "Copilot", url: "https://github.com/apps/copilot", isBot: true },
];

export const GITHUB_FIXTURE_REPOS: readonly RepoMetadata[] = [
  {
    owner: "alice",
    name: "dotfiles",
    fullName: "alice/dotfiles",
    url: "https://github.com/alice/dotfiles",
    description: "Opinionated dotfiles for macOS and Linux",
    topics: ["dotfiles", "stow", "zsh"],
    stars: 42,
    forks: 7,
    size: 128,
    language: "Shell",
    isFork: false,
    isArchived: false,
    updatedAt: "2026-05-25T10:00:00Z",
    pushedAt: "2026-05-25T09:30:00Z",
  },
  {
    owner: "alice",
    name: "terminal-setup",
    fullName: "alice/terminal-setup",
    url: "https://github.com/alice/terminal-setup",
    description: null,
    topics: ["terminal", "config"],
    stars: 18,
    forks: 3,
    size: 64,
    language: null,
    isFork: false,
    isArchived: false,
    updatedAt: "2026-05-24T08:00:00Z",
    pushedAt: "2026-05-24T07:45:00Z",
  },
  {
    owner: "alice",
    name: "shared-dotfiles",
    fullName: "shared/shared-dotfiles",
    url: "https://github.com/shared/shared-dotfiles",
    description: "Shared dotfiles discovered through multiple users",
    topics: ["dotfiles", "shared"],
    stars: 108,
    forks: 19,
    size: 256,
    language: "Nix",
    isFork: false,
    isArchived: false,
    updatedAt: "2026-05-23T11:20:00Z",
    pushedAt: "2026-05-23T11:10:00Z",
  },
  {
    owner: "bob",
    name: "config",
    fullName: "bob/config",
    url: "https://github.com/bob/config",
    description: "Forked config repo",
    topics: ["config", "dotfiles"],
    stars: 9,
    forks: 2,
    size: 32,
    language: "TypeScript",
    isFork: true,
    isArchived: false,
    updatedAt: "2026-05-22T14:00:00Z",
    pushedAt: "2026-05-22T13:30:00Z",
  },
  {
    owner: "bob",
    name: "old-dotfiles",
    fullName: "bob/old-dotfiles",
    url: "https://github.com/bob/old-dotfiles",
    description: null,
    topics: ["dotfiles", "archive"],
    stars: 4,
    forks: 1,
    size: 16,
    language: null,
    isFork: false,
    isArchived: true,
    updatedAt: "2025-11-01T06:00:00Z",
    pushedAt: "2025-10-31T23:59:00Z",
  },
  {
    owner: "bob",
    name: "shared-dotfiles",
    fullName: "shared/shared-dotfiles",
    url: "https://github.com/shared/shared-dotfiles",
    description: "Duplicate discovery from a second user",
    topics: ["dotfiles", "shared", "duplicated"],
    stars: 108,
    forks: 19,
    size: 256,
    language: "Nix",
    isFork: false,
    isArchived: false,
    updatedAt: "2026-05-23T11:20:00Z",
    pushedAt: "2026-05-23T11:10:00Z",
  },
  {
    owner: "charlie",
    name: "workstation",
    fullName: "charlie/workstation",
    url: "https://github.com/charlie/workstation",
    description: "Desktop bootstrap repo",
    topics: ["dotfiles", "bootstrap"],
    stars: 27,
    forks: 5,
    size: 96,
    language: "Python",
    isFork: false,
    isArchived: false,
    updatedAt: "2026-05-21T12:00:00Z",
    pushedAt: "2026-05-21T11:45:00Z",
  },
];

export const GITHUB_FIXTURE_CONTRIBUTORS: Record<string, readonly Contributor[]> = {
  "alice/dotfiles": [
    { login: "alice", url: "https://github.com/alice", contributions: 120, isBot: false },
    { login: "bob", url: "https://github.com/bob", contributions: 18, isBot: false },
    { login: "charlie", url: "https://github.com/charlie", contributions: 9, isBot: false },
    { login: "dependabot[bot]", url: "https://github.com/apps/dependabot", contributions: 6, isBot: true },
    { login: "renovate[bot]", url: "https://github.com/apps/renovate", contributions: 4, isBot: true },
  ],
  "bob/config": [
    { login: "bob", url: "https://github.com/bob", contributions: 95, isBot: false },
    { login: "alice", url: "https://github.com/alice", contributions: 12, isBot: false },
    { login: "github-actions[bot]", url: "https://github.com/apps/github-actions", contributions: 8, isBot: true },
    { login: "claude[bot]", url: "https://github.com/apps/claude", contributions: 3, isBot: true },
    { login: "copilot[bot]", url: "https://github.com/apps/copilot", contributions: 2, isBot: true },
  ],
  "charlie/workstation": [
    { login: "charlie", url: "https://github.com/charlie", contributions: 77, isBot: false },
    { login: "alice", url: "https://github.com/alice", contributions: 7, isBot: false },
    { login: "dependabot[bot]", url: "https://github.com/apps/dependabot", contributions: 2, isBot: true },
    { login: "renovate[bot]", url: "https://github.com/apps/renovate", contributions: 1, isBot: true },
  ],
};

export const GITHUB_FIXTURE_USER_REPOS: Record<string, readonly RepoMetadata[]> = {
  alice: [GITHUB_FIXTURE_REPOS[0], GITHUB_FIXTURE_REPOS[1], GITHUB_FIXTURE_REPOS[2]],
  bob: [GITHUB_FIXTURE_REPOS[3], GITHUB_FIXTURE_REPOS[4], GITHUB_FIXTURE_REPOS[5]],
  charlie: [GITHUB_FIXTURE_REPOS[6], GITHUB_FIXTURE_REPOS[2]],
};

export function cloneRepo(repo: RepoMetadata): RepoMetadata {
  return {
    ...repo,
    topics: [...repo.topics],
  };
}

export function cloneContributor(contributor: Contributor): Contributor {
  return { ...contributor };
}
