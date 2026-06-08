# Octosift

Octosift is a script-first Bun and TypeScript CLI for finding likely dotfiles and dev-environment repositories across GitHub users, repositories, URLs, and input files. It sifts GitHub repo candidates through metadata signals, then scores the strongest matches so stdout stays useful for scripts.

Run the CLI through the package script:

```sh
bun run octosift -- --help
```

Stdout is JSON or CSV only. Warnings, partial failures, auth notices, and errors go to stderr.

## Install

Clone the repo, then install with Bun:

```sh
bun install
```

That's it. There are no global install steps for the current script-first workflow.

## Quick Start

Scan a GitHub user:

```sh
bun run octosift -- LuisUrrutia
```

Scan a repository's human contributors, then scan each contributor's repositories one hop deep:

```sh
bun run octosift -- owner/repo
```

GitHub URLs work too. A user URL scans that user. A repository URL scans that repository's human contributors:

```sh
bun run octosift -- https://github.com/LuisUrrutia
bun run octosift -- https://github.com/owner/repo
```

Read newline-delimited inputs from a file with `--file` or the `@file` shorthand:

```sh
bun run octosift -- --file inputs.txt
bun run octosift -- @inputs.txt
```

Ask for CSV when rows fit your next tool better than JSON:

```sh
bun run octosift -- LuisUrrutia --format csv
```

Value flags accept both `--flag value` and `--flag=value`. For example, `--format=csv` and `--format csv` are the same.

## Accepted Inputs

Octosift accepts any mix of these scan inputs:

- `LuisUrrutia`
- `owner/repo`
- `https://github.com/LuisUrrutia`
- `https://github.com/owner/repo`
- `https://github.com/owner/repo.git`
- `https://github.com/owner/repo/issues`
- `--file path/to/inputs.txt`
- `@path/to/inputs.txt`

Only `--file <path>` and `@path` are treated as files. Everything else is parsed as a GitHub user, repository, or URL.

## Input File Format

Input files are plain text and newline-delimited:

- One input per line.
- Blank lines are ignored.
- Lines starting with `#` are ignored.
- Users, repositories, and GitHub URLs can be mixed in one file.

Example:

```txt
# users
LuisUrrutia

# repositories
owner/repo
https://github.com/owner/another-repo
```

## Output Contract

JSON is the default output format. It prints an array of candidate repositories with this field order:

```txt
url
owner
name
fullName
description
topics
stars
forks
language
isFork
isArchived
updatedAt
pushedAt
matchedSignals
score
sourceUser
sourceInput
```

`matchedSignals` contains `{ key, label, score, evidence }` objects. `sourceUser` and `sourceInput` are arrays in JSON so duplicate discoveries keep their provenance instead of being collapsed into a single source.

CSV uses the same fields in the same order. Array fields are serialized with semicolons, so `topics` might become `dotfiles;zsh;stow` and `sourceInput` might become `alice;owner/repo`.

## Options And Defaults

Common scan controls:

```sh
bun run octosift -- owner/repo --max-contributors 25
bun run octosift -- LuisUrrutia --max-repos 100
bun run octosift -- LuisUrrutia --min-score 5
```

- `--format json|csv` sets output format. The default is `json`.
- `--min-score <number>` filters final candidates. The default is `3`.
- `--max-contributors <number>` limits human contributors scanned per repository. The default is `50`.
- `--max-repos <number>` limits repositories scanned per user. The default is unlimited.

Cache controls:

```sh
bun run octosift -- LuisUrrutia --no-cache
bun run octosift -- LuisUrrutia --cache-ttl 60
bun run octosift -- --clear-cache
```

GitHub API responses are stored in a persistent cache at `~/.local/share/dotfiles-finder/`. The default cache TTL is 6 hours, or 21600 seconds. The cache covers user repository responses and repository contributor responses, but it does not cache final filtered CLI output.

Use `--no-cache` to bypass cache reads and writes. Use `--cache-ttl <seconds>` to set a finite integer TTL, where `0` refreshes on every run. Use `--clear-cache` to delete the cache directory and exit without scanning.

The exclusive commands `--help`, `--version`, and `--clear-cache` cannot be combined with scan inputs or scan flags.

## Scoring

Scoring is metadata-only. Octosift looks at repository names, descriptions, topics, fork status, and archived status. It does not inspect repository contents.

- Strong signals add `+5`.
- Medium signals add `+3`.
- Weak signals add `+1`.
- Forks add `-1`.
- Archived repositories add `-2`.
- If the same term appears in more than one tier, only the highest-tier match counts.
- Scores never go below `0`.
- The default minimum output score is `3`.

Current signals include dotfiles and dev-environment terms such as `dotfiles`, `.files`, `chezmoi`, `home-manager`, `nix-config`, `nvim-config`, `stow`, `nvim`, `neovim`, `vimrc`, `zsh`, `tmux`, `brewfile`, `terminal`, `shell`, `setup`, `macos`, `linux`, `developer environment`, `dev environment`, `workstation`, `bootstrap`, and `install`.

## Bot Filtering

Repository contributor expansion skips bots before applying `--max-contributors`. A contributor is filtered when GitHub marks it with type `Bot`, when the internal contributor flag is `isBot`, or when the login or name matches known automation terms for GitHub Actions, Dependabot, Renovate, Claude, Copilot, and `[bot]` accounts:

- `github-actions`
- `github actions`
- `dependabot`
- `renovate`
- `claude`
- `copilot`
- `[bot]`

## Authentication And Rate Limits

Client selection happens once at startup, in this order:

1. Authenticated `gh`, checked with `gh auth status`.
2. GitHub REST with `GH_TOKEN`.
3. GitHub REST with `GITHUB_TOKEN`.
4. Unauthenticated GitHub REST.

Unauthenticated REST prints this exact warning to stderr: `Using unauthenticated GitHub REST API; rate limits will be lower.`

Octosift scans sequentially on purpose. It avoids parallel GitHub calls so request order stays predictable and rate-limit pressure stays lower. If GitHub reports an exhausted rate limit, scanning stops and the CLI exits with code `3`. Other recoverable request failures return partial output with warnings on stderr.

Exit codes:

- `0`: success.
- `1`: invalid input or configuration.
- `2`: partial failure with usable output.
- `3`: rate limit exhausted.

## v1.1 Limits

Octosift v1.1 is intentionally metadata-only. It does not inspect README files, repository content, file trees, branches, dotfile paths, or other repository internals.

It also does not use GraphQL, cache servers, a TUI, interactive prompts, or recursive contributor expansion beyond repository to contributors to contributor repositories.

## Local QA

Useful scripts:

```sh
bun run octosift -- --help
bun run start -- --help
bun run dev -- --help
bun run check
bun run qa
```

`octosift` and `start` run the CLI entrypoint. `dev` runs the same entrypoint in Bun watch mode. `check` runs typecheck and tests. `qa` is the same full local project check:

```sh
bun run qa
```

That runs `bun run typecheck` and then `bun test` sequentially.
