# Dotfiles Finder

Dotfiles Finder is a script-first CLI for discovering likely dotfiles repositories from GitHub users, repositories, URLs, and input files.

## Language

**GitHub response mapping**:
Translating raw GitHub repository and contributor response objects into the CLI's domain metadata shapes. It maps known fields and contributor bot classification without validating transport payloads or deciding scan policy.
_Avoid_: GitHub response normalization, transport mapping

**CLI command orchestration**:
Turning command-line arguments into one script-safe command lifecycle: parse command intent, preserve short-circuit command modes, prepare runtime dependencies, run the scan, emit machine-readable output, route warnings and errors to stderr, and return the final exit code.
_Avoid_: argument parsing, CLI service

**Scan candidate lifecycle**:
Turning normalized GitHub inputs into raw dotfiles candidates by applying repository discovery traversal, one-hop contributor expansion, bot and cap policy, scoring, provenance merging, warning normalization, and rate-limit stop behavior.
_Avoid_: scanner logic, repository search service
