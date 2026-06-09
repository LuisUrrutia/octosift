# Octosift

Octosift is a script-first Bun and TypeScript CLI for finding candidate repositories for an explicit search intent across GitHub users, repositories, URLs, and input files. It sifts GitHub repo candidates through metadata signals, then scores the strongest matches so stdout stays useful for scripts.

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

Choose a search intent first. `dotfiles` finds likely dotfiles and dev-environment repositories. `skills` finds reusable AI-agent skill-pack repositories such as Claude skills, OpenCode skills, AI agent workflow skills, and MCP skills.

Scan a GitHub user for dotfiles:

```sh
bun run octosift -- dotfiles LuisUrrutia
```

Scan a GitHub user for reusable agent skills:

```sh
bun run octosift -- skills LuisUrrutia
```

Use a repository as a contributor seed. Octosift lists the repository's human contributors, skips bots, then scans each contributor's repositories one hop deep:

```sh
bun run octosift -- dotfiles owner/repo
```

GitHub URLs work too. A user URL scans that user. A repository URL uses that repository as a contributor seed:

```sh
bun run octosift -- dotfiles https://github.com/LuisUrrutia
bun run octosift -- dotfiles https://github.com/owner/repo
```

Read newline-delimited inputs from a file with `--file` or the `@file` shorthand:

```sh
bun run octosift -- dotfiles --file inputs.txt
bun run octosift -- dotfiles @inputs.txt
```

Ask for CSV when rows fit your next tool better than JSON:

```sh
bun run octosift -- dotfiles LuisUrrutia --format csv
```

Add `--verbose` when you need matched scoring signals and source provenance in the output:

```sh
bun run octosift -- dotfiles LuisUrrutia --verbose
```

Value flags accept both `--flag value` and `--flag=value`. For example, `--format=csv` and `--format csv` are the same.

## Accepted Inputs

Every scan requires one search intent subcommand before scan inputs. Built-in intents are `dotfiles` and `skills`; TOML definitions can add more. After the intent, Octosift accepts any mix of these scan inputs:

- `LuisUrrutia`
- `owner/repo`
- `https://github.com/LuisUrrutia`
- `https://github.com/owner/repo`
- `https://github.com/owner/repo.git`
- `https://github.com/owner/repo/issues`
- `--file path/to/inputs.txt`
- `@path/to/inputs.txt`

Only `--file <path>` and `@path` are treated as files. Everything else is parsed as a GitHub user, repository, or URL.

Input shape controls where candidates come from:

- A user input lists that user's repositories and scores those repositories against the selected search intent.
- A repository input lists that repository's human contributors first, then lists and scores each contributor's repositories. The repository input is a contributor seed, not a request to score only that repository.
- A GitHub URL follows the same rule after URL normalization: user URLs scan user repositories, and repository URLs scan contributor repositories one hop deep.

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
fullName
description
stars
forks
language
isFork
isArchived
updatedAt
pushedAt
score
```

Final output is sorted by `score` descending, then by `pushedAt` descending for candidates with the same score.

Use `--verbose` to add these fields to JSON and CSV output:

```txt
owner
name
topics
matchedSignals
sourceUser
sourceInput
```

`owner`, `name`, and `topics` are hidden by default because `fullName` is the compact repository identifier. `matchedSignals` contains `{ key, label, score, evidence }` objects. `sourceUser` and `sourceInput` are arrays in verbose JSON so duplicate discoveries keep their provenance instead of being collapsed into a single source.

CSV uses the same default fields in the same order. With `--verbose`, CSV emits the full field set: `url,owner,name,fullName,description,topics,stars,forks,language,isFork,isArchived,updatedAt,pushedAt,matchedSignals,score,sourceUser,sourceInput`. Array fields are serialized with semicolons, so verbose `topics` might become `dotfiles;zsh;stow` and verbose `sourceInput` might become `alice;owner/repo`.

## Options And Defaults

Common scan controls:

```sh
bun run octosift -- dotfiles owner/repo --max-contributors 25
bun run octosift -- dotfiles LuisUrrutia --max-repos 100
bun run octosift -- skills LuisUrrutia --min-score 5
```

- `--format json|csv` sets output format. The default is `json`.
- `--min-score <number>` filters final candidates. The default is `3`.
- `--max-contributors <number>` limits human contributors scanned per repository. The default is `50`.
- `--max-repos <number>` limits repositories scanned per user. The default is unlimited.
- `--ignore-forks` omits fork repositories from final output. Forks are included by default.
- `--verbose` includes `owner`, `name`, `topics`, `matchedSignals`, `sourceUser`, and `sourceInput` in JSON and CSV output.

Cache controls:

```sh
bun run octosift -- dotfiles LuisUrrutia --no-cache
bun run octosift -- dotfiles LuisUrrutia --cache-ttl 60
bun run octosift -- --clear-cache
```

GitHub API responses are stored in a persistent cache at `~/.local/share/octosift/`. The default cache TTL is 72 hours, or 259200 seconds. The cache covers user repository responses and repository contributor responses, but it does not cache final filtered CLI output.

Use `--no-cache` to bypass cache reads and writes. Use `--cache-ttl <seconds>` to set a finite integer TTL, where `0` refreshes on every run. Use `--clear-cache` to delete the cache directory and exit without scanning. Use `--config-dir <dir>` to load TOML search intent definitions from that directory instead of the default `./config` directory.

The exclusive commands `--help`, `--version`, and `--clear-cache` cannot be combined with scan inputs or scan flags.

## Search Intents And Scoring

Scoring is metadata-only. Octosift looks at repository names, descriptions, topics, fork status, and archived status. It does not inspect repository contents.

- Strong signals add `+5`.
- Medium signals add `+3`.
- Weak signals add `+1`.
- Exact repository names `dotfiles`, `.dotfiles`, `skill`, and `skills` add `+10` for their matching search intent.
- Forks add `-1`.
- Archived repositories add `-2`.
- If the same term appears in more than one tier, only the highest-tier match counts.
- Scores never go below `0`.
- The default minimum output score is `3`.
- Repositories whose GitHub metadata reports `size` as `0` are ignored before scoring.

The `dotfiles` intent preserves current dotfiles traversal and scoring. Signals include dotfiles and dev-environment terms such as `dotfiles`, `.files`, `chezmoi`, `home-manager`, `nix-config`, `nvim-config`, `stow`, `nvim`, `neovim`, `vimrc`, `zsh`, `tmux`, `brewfile`, `terminal`, `shell`, `setup`, `macos`, `linux`, `developer environment`, `dev environment`, `workstation`, `bootstrap`, and `install`.

The `skills` intent uses conservative metadata-only scoring for reusable AI-agent skill-pack repositories. Signals must explicitly describe agent skills, Claude skills, OpenCode skills, AI agent workflows, MCP skills, or equivalent reusable agent-skill packs. Generic AI, devtool, tutorial, prompt, workflow, automation, assistant, or coding-agent metadata is not enough.

### TOML Search Intent Definitions

Octosift builds a search intent definition catalog for each scan. The catalog starts with the built-in `dotfiles` and `skills` definitions, then loads every `*.toml` file in `./config` relative to the current working directory. Pass `--config-dir <dir>` to use another directory. TOML files load in lexicographic filename order, each file may define multiple `[[intent]]` entries, and a later same-name intent replaces the whole earlier definition. A missing or empty default `./config` keeps built-ins only. A missing explicit `--config-dir` exits with invalid configuration before GitHub client selection.

Invalid TOML or invalid definition shape fails the command. Definitions are not skipped silently.

Example `config/workstations.toml`:

```toml
[[intent]]
name = "workstations"
normalization = "lowercase"

[[intent.exact_name]]
name = "workstation"
score = 10
label = "exact workstation repository name"

[[intent.term_group]]
label = "strong workstation metadata signal"
score = 5
terms = ["workstation", "developer environment", "terminal setup"]
fields = ["name", "description", "topics"]

[intent.penalties]
fork = -1
archived = -2
```

Example `config/nvim.toml` for finding Neovim/Vim configuration repositories:

```toml
[[intent]]
name = "nvim"
normalization = "lowercase-separators"

[[intent.exact_name]]
name = "nvim-config"
score = 20
label = "exact Neovim config repository name"

[[intent.exact_name]]
name = "neovim-config"
score = 20
label = "exact Neovim config repository name"

[[intent.exact_name]]
name = "vim-config"
score = 20
label = "exact Vim config repository name"

[[intent.exact_name]]
name = "vimrc"
score = 20
label = "exact Vim config repository name"

[[intent.exact_name]]
name = ".vimrc"
score = 20
label = "exact Vim config repository name"

[[intent.exact_name]]
name = "neovimrc"
score = 20
label = "exact Neovim config repository name"

[[intent.term_group]]
label = "strong Neovim config metadata signal"
score = 8
terms = ["nvim config", "neovim config", "vim config", "lua config", "lsp config", "treesitter config", "lazyvim", "kickstart nvim", "astronvim", "nvchad"]
fields = ["name", "description", "topics"]

[[intent.term_group]]
label = "medium Vim configuration metadata signal"
score = 3
terms = ["editor config", "personal vim", "personal neovim", "my vim", "my neovim"]
fields = ["name", "description", "topics"]

[intent.penalties]
fork = -1
archived = -2
```

Run it with forked repositories omitted from final output:

```bash
bun run octosift -- nvim --ignore-forks theprimeagen
```

`--ignore-forks` is a CLI output filter. The TOML definition can penalize forks, but it does not exclude them by itself.

Supported declarative scoring fields are:

- `normalization`: `lowercase` or `lowercase-separators`.
- `[[intent.exact_name]]`: exact repository-name boosts with `name`, `score`, and `label`; optional `key` and `dedupe_term` tune matched-signal identity and duplicate term handling.
- `[[intent.term_group]]`: weighted term groups with `label`, `score`, `terms`, and `fields`; fields may be `name`, `description`, and `topics`; optional `dedupe = false` allows overlapping terms to score independently.
- `[intent.penalties]`: `fork` and `archived` metadata penalties. Omitted penalties default to the built-in `-1` fork and `-2` archived behavior.
- `clamp_min_score`: optional minimum final score, default `0`.

The format is metadata-only. It does not run formulas, JavaScript, shell commands, scripts, or repository-content inspection.

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
