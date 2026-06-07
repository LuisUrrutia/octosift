import { expect, test } from "bun:test";

import { GitHubClientError } from "../src/github/client";
import { GhGitHubClient, type GhCommand } from "../src/github/gh-adapter";
import { RestGitHubClient, type GitHubFetch } from "../src/github/rest-adapter";
import { selectGitHubClient } from "../src/github/select-client";

const repoPageOne = [
  {
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
    pushed_at: "2026-05-25T09:30:00Z",
    owner: { login: "alice" },
  },
];

const repoPageTwo = [
  {
    name: "terminal-setup",
    full_name: "alice/terminal-setup",
    html_url: "https://github.com/alice/terminal-setup",
    description: "Terminal setup",
    topics: null,
    stargazers_count: 18,
    forks_count: 3,
    language: "Shell",
    fork: true,
    archived: true,
    updated_at: null,
    pushed_at: null,
    owner: { login: "alice" },
  },
];

const contributors = [
  { login: "alice", html_url: "https://github.com/alice", contributions: 12, type: "User" },
  { login: "dependabot[bot]", html_url: "https://github.com/apps/dependabot", contributions: 4, type: "Bot" },
];

test("gh adapter invokes gh api with disabled prompts and returns mapped repos", async () => {
  const commands: GhCommand[] = [];
  const client = new GhGitHubClient({
    env: { GH_TOKEN: "token" },
    run: async (command) => {
      commands.push(command);
      return { stdout: JSON.stringify(repoPageOne) };
    },
  });

  const repos = await client.listUserRepos("alice");

  expect(commands.length).toBe(1);
  expect(commands[0].command).toBe("gh");
  expect(commands[0].args.join(" ")).toBe("api /users/alice/repos --method GET -F per_page=100 --paginate");
  expect(commands[0].env.GH_PROMPT_DISABLED).toBe("1");
  expect(commands[0].env.GH_TOKEN).toBe("token");
  expect(repos[0].fullName).toBe("alice/dotfiles");
});

test("gh adapter uses contributors endpoint and returns mapped contributors", async () => {
  const commands: GhCommand[] = [];
  const client = new GhGitHubClient({
    run: async (command) => {
      commands.push(command);
      return { stdout: JSON.stringify(contributors) };
    },
  });

  const result = await client.listRepoContributors("alice", "dotfiles");

  expect(commands[0].args.join(" ")).toBe("api /repos/alice/dotfiles/contributors --method GET -F per_page=100 --paginate");
  expect(commands[0].env.GH_PROMPT_DISABLED).toBe("1");
  expect(result[0].login).toBe("alice");
  expect(result[0].url).toBe("https://github.com/alice");
  expect(result[0].contributions).toBe(12);
  expect(result[1].login).toBe("dependabot[bot]");
});

test("gh adapter maps gh api rate limit failures to structured error", async () => {
  const client = new GhGitHubClient({
    run: async () => ({ stdout: "", stderr: "HTTP 403: API rate limit exceeded\nretry-after: 30", status: 1 }),
  });

  try {
    await client.listUserRepos("alice");
    throw new Error("expected rate limit error");
  } catch (error) {
    const clientError = error as GitHubClientError;
    expect(clientError.name).toBe("GitHubClientError");
    expect(clientError.kind).toBe("rate-limit");
    expect(clientError.endpoint).toBe("/users/alice/repos");
    expect(clientError.status).toBe(403);
    expect(clientError.retryAfterSeconds).toBe(30);
    expect(clientError.message).toContain("API rate limit exceeded");
  }
});

test("REST adapter follows pagination sequentially and maps repos", async () => {
  const calls: string[] = [];
  let activeFetches = 0;
  const fetch: GitHubFetch = async (url, init) => {
    activeFetches += 1;
    if (activeFetches > 1) {
      throw new Error("fetches overlapped");
    }

    calls.push(`${url}|${init.headers.Accept}|${init.headers["X-GitHub-Api-Version"]}|${init.headers.Authorization}`);
    activeFetches -= 1;

    if (calls.length === 1) {
      return jsonResponse(repoPageOne, { link: '<https://api.github.test/users/alice/repos?page=2>; rel="next"' });
    }

    return jsonResponse(repoPageTwo);
  };

  const client = new RestGitHubClient({ fetch, token: "rest-token", baseUrl: "https://api.github.test" });
  const repos = await client.listUserRepos("alice");

  expect(calls.length).toBe(2);
  expect(calls[0]).toContain("https://api.github.test/users/alice/repos?per_page=100");
  expect(calls[0]).toContain("application/vnd.github+json");
  expect(calls[0]).toContain("2022-11-28");
  expect(calls[0]).toContain("Bearer rest-token");
  expect(calls[1]).toContain("page=2");
  expect(repos.length).toBe(2);
  expect(repos[1].fullName).toBe("alice/terminal-setup");
});

test("REST adapter returns mapped contributors", async () => {
  const client = new RestGitHubClient({
    fetch: async () => jsonResponse(contributors),
    baseUrl: "https://api.github.test",
  });

  const result = await client.listRepoContributors("alice", "dotfiles");

  expect(result[0].login).toBe("alice");
  expect(result[1].login).toBe("dependabot[bot]");
});

test("REST adapter maps rate limit failures to structured error", async () => {
  const client = new RestGitHubClient({
    fetch: async () =>
      jsonResponse(
        { message: "API rate limit exceeded" },
        {
          status: 403,
          "x-ratelimit-remaining": "0",
          "x-ratelimit-limit": "60",
          "x-ratelimit-reset": "1780000000",
          "retry-after": "30",
        },
      ),
    baseUrl: "https://api.github.test",
  });

  try {
    await client.listUserRepos("alice");
    throw new Error("expected rate limit error");
  } catch (error) {
    const clientError = error as GitHubClientError;
    expect(clientError.name).toBe("GitHubClientError");
    expect(clientError.kind).toBe("rate-limit");
    expect(clientError.status).toBe(403);
    expect(clientError.retryAfterSeconds).toBe(30);
    expect(clientError.rateLimit?.remaining).toBe(0);
    expect(clientError.rateLimit?.limit).toBe(60);
    expect(clientError.message).toBe("API rate limit exceeded");
  }
});

test("REST adapter maps forbidden failures separately from rate limits", async () => {
  const client = new RestGitHubClient({
    fetch: async () => jsonResponse({ message: "Resource forbidden" }, { status: 403, "x-ratelimit-remaining": "12" }),
    baseUrl: "https://api.github.test",
  });

  try {
    await client.listRepoContributors("alice", "private");
    throw new Error("expected forbidden error");
  } catch (error) {
    const clientError = error as GitHubClientError;
    expect(clientError.kind).toBe("forbidden");
    expect(clientError.status).toBe(403);
  }
});

test("client selection prefers authenticated gh before token REST", async () => {
  let probeCalls = 0;
  const selected = await selectGitHubClient({
    probes: {
      isGhAuthenticated: async () => {
        probeCalls += 1;
        return true;
      },
    },
    ghRunner: async () => ({ stdout: "[]" }),
    env: { GH_TOKEN: "token" },
    fetch: async () => jsonResponse([]),
  });

  expect(selected.kind).toBe("gh");
  expect(selected.cachePartition).toEqual({ kind: "gh" });
  expect(selected.warnings.length).toBe(0);
  expect(probeCalls).toBe(1);
});

test("client selection uses GH_TOKEN REST when gh is unavailable", async () => {
  const selected = await selectGitHubClient({
    probes: { isGhAuthenticated: async () => false },
    ghRunner: async () => {
      throw new Error("gh should not be used after selection");
    },
    env: { GH_TOKEN: "primary", GITHUB_TOKEN: "secondary" },
    fetch: async (url, init) => {
      expect(init.headers.Authorization).toBe("Bearer primary");
      return jsonResponse([]);
    },
  });

  expect(selected.kind).toBe("rest-token");
  expect(selected.cachePartition.kind).toBe("rest-token");
  if (selected.cachePartition.kind !== "rest-token") {
    throw new Error("expected token cache partition");
  }
  expect(selected.cachePartition.credentialIdentity.startsWith("GH_TOKEN:sha256:")).toBe(true);
  expect(JSON.stringify(selected.cachePartition).includes("primary")).toBe(false);
  await selected.client.listUserRepos("alice");
});

test("client selection falls back to unauthenticated REST with warning", async () => {
  const selected = await selectGitHubClient({
    probes: { isGhAuthenticated: async () => false },
    ghRunner: async () => {
      throw new Error("gh should not be used after selection");
    },
    env: {},
    fetch: async (_url, init) => {
      expect(String(init.headers.Authorization)).toBe("undefined");
      return jsonResponse([]);
    },
  });

  expect(selected.kind).toBe("rest-public");
  expect(selected.cachePartition).toEqual({ kind: "rest-public" });
  expect(selected.warnings.length).toBe(1);
  expect(selected.warnings[0].message).toContain("unauthenticated");
  await selected.client.listUserRepos("alice");
});

function jsonResponse(body: unknown, headers: Record<string, string | number> = {}): Response {
  const status = typeof headers.status === "number" ? headers.status : 200;
  const responseHeaders = new Headers();

  for (const [key, value] of Object.entries(headers)) {
    if (key !== "status") {
      responseHeaders.set(key, String(value));
    }
  }

  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}
