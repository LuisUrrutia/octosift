# Octosift

Octosift is a script-first CLI for discovering repository candidates for an explicit search intent from GitHub users, repositories, URLs, and input files.

## Language

**GitHub response mapping**:
Translating raw GitHub repository and contributor response objects into the CLI's domain metadata shapes. It maps known fields and contributor bot classification without validating transport payloads or deciding scan policy.
_Avoid_: GitHub response normalization, transport mapping

**CLI command orchestration**:
Turning command-line arguments into one script-safe command lifecycle: parse command intent, preserve short-circuit command modes, prepare runtime dependencies, run the scan, emit machine-readable output, route warnings and errors to stderr, and return the final exit code.
_Avoid_: argument parsing, CLI service

**Search intent**:
The repository kind the user wants Octosift to discover, separate from the GitHub users, repositories, URLs, or input files that say where to search. Search intents can be built in or user-defined; real examples include dotfiles repositories and agent skill repositories. A scan command is semantically incomplete without an explicit search intent.
_Avoid_: search query, target type, category flag

**Search intent definition**:
A declarative description of how Octosift recognizes and scores one search intent from repository metadata. Built-in definitions provide the default intent registry, and user-provided definitions can extend that registry or replace an entire same-name definition without changing where the scan looks. A definition describes metadata scoring data such as exact-name boosts, weighted term groups over repository name, description, and topics, penalties, and normalization choices; it does not contain executable scoring logic.
_Avoid_: scoring config, rule file, intent implementation

**Search intent definition catalog**:
The ordered collection of search intent definitions available to a scan. The catalog is the source of valid search intent names. It starts from code-defined built-in definitions and can be extended from a config directory resolved from the current working directory by loading TOML files in lexicographic filename order; later definitions replace earlier same-name definitions. Each TOML file may contain multiple definitions. A missing or empty default config directory leaves the built-in catalog unchanged, while a missing explicitly requested config directory is invalid. Invalid definitions make the catalog invalid rather than being skipped.
_Avoid_: config bundle, rules directory, search registry

**Agent skill repository candidate**:
A repository whose public metadata presents reusable AI-agent skill packs, such as Claude skills, OpenCode skills, or agent workflow skills. It is not generic educational material about developer skills, and it is not a dotfiles repository that merely stores agent configuration unless its metadata presents reusable agent skills.
_Avoid_: skills repo, tutorial repository, agent config repository

**Search candidate**:
A repository candidate for a specific search intent, carrying matched metadata signals, score, and provenance for why it was returned. Search candidates are intent-neutral; dotfiles and agent skills use the same candidate shape.
_Avoid_: dotfiles candidate, result item, repository match

**Scan candidate lifecycle**:
Turning normalized GitHub inputs into raw search candidates by applying repository discovery traversal, one-hop contributor expansion, bot and cap policy, intent-specific scoring, provenance merging, warning normalization, and rate-limit stop behavior.
_Avoid_: scanner logic, repository search service

**GitHub cache policy**:
Deciding how GitHub API responses are cached across selected client modes, including cache key scope, auth-context partitioning, cached payload shape identity, TTL/read-through behavior, and miss/stale semantics without owning filesystem storage, client selection, scan traversal, or CLI clear-cache behavior.
_Avoid_: cache storage, GitHub client selection

**GitHub test adapter**:
A test-only GitHub client that satisfies the production GitHub client seam while providing deterministic fixture responses, call-order recording, and queued failure simulation for scanner and CLI tests.
_Avoid_: GitHub fake, test mock
