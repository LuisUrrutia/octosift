import { expect, test } from "bun:test";

const bun = Bun as typeof Bun & { file(path: string): { text(): Promise<string> } };
const readme = await bun.file("README.md").text();

const requiredTerms = [
  "bun run dotfiles-finder -- LuisUrrutia",
  "owner/repo",
  "https://github.com/LuisUrrutia",
  "--file inputs.txt",
  "@inputs.txt",
  "--format csv",
  "--max-contributors",
  "--max-repos",
  "--min-score",
  "--no-cache",
  "--cache-ttl <seconds>",
  "--clear-cache",
  "exclusive commands",
  "--flag=value",
  "newline-delimited",
  "Blank lines are ignored",
  "Lines starting with `#` are ignored",
  "url",
  "owner",
  "name",
  "fullName",
  "description",
  "topics",
  "stars",
  "forks",
  "language",
  "isFork",
  "isArchived",
  "updatedAt",
  "pushedAt",
  "matchedSignals",
  "score",
  "sourceUser",
  "sourceInput",
  "JSON is the default output format",
  "Array fields are serialized with semicolons",
  "Strong signals add `+5`",
  "Medium signals add `+3`",
  "Weak signals add `+1`",
  "Forks add `-1`",
  "Archived repositories add `-2`",
  "only the highest-tier match counts",
  "default minimum output score is `3`",
  "type `Bot`",
  "GitHub Actions",
  "github-actions",
  "dependabot",
  "renovate",
  "claude",
  "copilot",
  "[bot]",
  "Authenticated `gh`",
  "`GH_TOKEN`",
  "`GITHUB_TOKEN`",
  "Unauthenticated GitHub REST",
  "rate limits will be lower",
  "`0`: success",
  "`1`: invalid input or configuration",
  "`2`: partial failure with usable output",
  "`3`: rate limit exhausted",
  "metadata-only",
  "README files",
  "repository content",
  "file trees",
  "branches",
  "GraphQL",
  "persistent cache",
  "~/.local/share/dotfiles-finder/",
  "does not cache final filtered CLI output",
  "TUI",
  "recursive contributor expansion",
];

test("README documents required usage, schema, scoring, auth, and v1 limits", () => {
  for (const term of requiredTerms) {
    expect(readme).toContain(term);
  }
});

test("README stays practical and avoids disallowed docs scope", () => {
  expect(readme.includes("CI workflow")).toBe(false);
});
