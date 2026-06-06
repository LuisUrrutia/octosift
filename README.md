# dotfiles-finder

`dotfiles-finder` is a Bun and TypeScript CLI for finding likely dotfiles repositories from GitHub users, repositories, URLs, and input files. It is script-first: stdout is JSON or CSV only, while warnings and errors go to stderr.

## Install

Clone the project and install dependencies with Bun:

```sh
bun install
```

Run the CLI through the package script:

```sh
bun run dotfiles-finder -- --help
```

## Usage

Scan a GitHub user:

```sh
bun run dotfiles-finder -- LuisUrrutia
```

Scan contributors of a repository, then scan each human contributor's repositories one hop deep:

```sh
bun run dotfiles-finder -- LuisUrrutia/dotfiles
```

GitHub URLs work too. User URLs scan that user, and repository URLs scan the repository's human contributors:

```sh
bun run dotfiles-finder -- https://github.com/LuisUrrutia
bun run dotfiles-finder -- https://github.com/LuisUrrutia/dotfiles
```

Read newline-delimited inputs from a file with `--file` or `@path`:

```sh
bun run dotfiles-finder -- --file inputs.txt
bun run dotfiles-finder -- @inputs.txt
```

Use CSV when you want rows instead of JSON:

```sh
bun run dotfiles-finder -- LuisUrrutia --format csv
```

Value flags support both `--flag value` and `--flag=value` forms. For example, `--format=csv` is equivalent to `--format csv`.

Useful limits:

```sh
bun run dotfiles-finder -- owner/repo --max-contributors 25
bun run dotfiles-finder -- LuisUrrutia --max-repos 100
bun run dotfiles-finder -- LuisUrrutia --min-score 5
```

`--max-contributors` defaults to `50` human contributors per repository. `--max-repos` defaults to unlimited. `--min-score` defaults to `3` and filters the final output after scanning.

GitHub API responses are cached by default under `~/.local/share/dotfiles-finder/` for 6 hours. The cache stores user repository responses and repository contributor responses separately; it does not cache final filtered CLI output.

```sh
bun run dotfiles-finder -- LuisUrrutia --no-cache
bun run dotfiles-finder -- LuisUrrutia --cache-ttl 60
bun run dotfiles-finder -- --clear-cache
```

Use `--no-cache` to bypass persistent cache reads and writes, `--cache-ttl <seconds>` to set a finite integer TTL where `0` refreshes every run, and `--clear-cache` to delete the cache directory and exit without scanning.

The exclusive commands `--help`, `--version`, and `--clear-cache` cannot be combined with scan inputs or scan flags.

## Accepted input forms

The CLI accepts these forms:

- `LuisUrrutia`
- `owner/repo`
- `https://github.com/LuisUrrutia`
- `https://github.com/owner/repo`
- `https://github.com/owner/repo.git`
- `https://github.com/owner/repo/issues`
- `--file path/to/inputs.txt`
- `@path/to/inputs.txt`

Only `--file <path>` and `@path` are treated as files. Other values are parsed as GitHub inputs.

## File format

Input files are plain text:

- One input per line.
- Blank lines are ignored.
- Lines starting with `#` are ignored.
- The same accepted user, repository, and URL forms can be mixed in one file.

Example:

```txt
# users
LuisUrrutia

# repositories
owner/repo
https://github.com/owner/another-repo
```

## Output

JSON is the default output format. It prints an array of candidates with this schema:

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

`matchedSignals` is an array of `{ key, label, score, evidence }` objects. `sourceUser` and `sourceInput` are arrays in JSON so duplicate discoveries keep their provenance.

CSV uses the same field order as the JSON schema. Array fields are serialized with semicolons. For example, `topics` may be `dotfiles;zsh;stow`, and `sourceInput` may be `alice;owner/repo`.

## Scoring rules

Scoring is metadata-only. The scanner looks at repository names, descriptions, topics, fork status, and archived status.

- Strong signals add `+5`.
- Medium signals add `+3`.
- Weak signals add `+1`.
- Forks add `-1`.
- Archived repositories add `-2`.
- If the same term appears in more than one tier, only the highest-tier match counts.
- Scores never go below `0`.
- The default minimum output score is `3`.

Current signals include dotfiles terms such as `dotfiles`, `.files`, `chezmoi`, `home-manager`, `nix-config`, `nvim-config`, `stow`, `nvim`, `neovim`, `vimrc`, `zsh`, `tmux`, `brewfile`, `terminal`, `shell`, `setup`, `macos`, `linux`, `developer environment`, `dev environment`, `workstation`, `bootstrap`, and `install`.

## Bot filtering

Repository contributor expansion skips bots before applying the contributor limit. A contributor is filtered when GitHub marks it with type `Bot`, when the internal contributor flag is `isBot`, or when the login or name matches these patterns for GitHub Actions, Dependabot, Renovate, Claude, Copilot, and `[bot]` accounts:

- `github-actions`
- `github actions`
- `dependabot`
- `renovate`
- `claude`
- `copilot`
- `[bot]`

## Authentication and rate limits

Client selection happens once at startup:

1. Authenticated `gh`, checked with `gh auth status`.
2. GitHub REST with `GH_TOKEN`.
3. GitHub REST with `GITHUB_TOKEN`.
4. Unauthenticated GitHub REST.

Unauthenticated REST prints this warning to stderr: `Using unauthenticated GitHub REST API; rate limits will be lower.`

The scanner is sequential on purpose. It avoids parallel GitHub calls so request order stays predictable and rate-limit pressure stays lower. If GitHub reports a rate limit, scanning stops and the CLI returns exit code `3`. Other recoverable request failures return partial output with warnings on stderr.

Exit codes:

- `0`: success.
- `1`: invalid input or configuration.
- `2`: partial failure with usable output.
- `3`: rate limit exhausted.

## v1.1 limits

This version is intentionally metadata-only. It does not inspect README files, repository content, file trees, branches, or dotfile paths. It also does not use GraphQL, cache servers, a TUI, interactive prompts, or recursive contributor expansion beyond repository to contributors to contributor repositories.

## Local QA

Run the same local check used for task QA:

```sh
bun run qa
```

That runs `bun run typecheck` and then `bun test` sequentially.
