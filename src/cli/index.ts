import { FileCache } from "../cache/file-cache";
import { EXIT_CODE_INVALID_INPUT, type SearchCandidate, type ExitCode, type ScanResult } from "../domain/types";
import { type SelectedGitHubClient } from "../github/client";
import { createDefaultGitHubClient } from "../github/select-client";
import { normalizeInputs, type NormalizeInputValue, type NormalizeInputsResult } from "../input/normalize";
import { formatOutput, type OutputFormat } from "../output/format";
import type { OutputOptions } from "../output/schema";
import { scanInputs, type ScanOptions } from "../scan/index";
import { loadSearchIntentCatalog, type SearchIntentCatalog } from "../rules/search-intent-catalog";
import { parseCommandIntent } from "./command-intent";
import { expandCliInputArgs, type ExpandCliInputArgsOptions, type ExpandCliInputArgsResult } from "./input-expansion";
import {
  formatClientConfigurationError,
  formatInputErrors,
  type CliWriters,
  writeErrors,
  writeOutput,
  writeWarnings,
} from "./emission";
import { selectFinalCandidates } from "./final-candidates";
import { prepareRuntime } from "./runtime";

export const VERSION = "0.0.0";

const EMPTY_INPUT_ERROR = "At least one GitHub user, repository, URL, or input file is required.";

export type { CliWriters } from "./emission";

export interface CliDependencies {
  expandInputArgs(args: readonly string[], options?: ExpandCliInputArgsOptions): Promise<ExpandCliInputArgsResult>;
  normalizeInputs(values: readonly NormalizeInputValue[]): Promise<NormalizeInputsResult>;
  createDefaultGitHubClient(): Promise<SelectedGitHubClient>;
  scanInputs(inputs: NormalizeInputsResult["inputs"], client: SelectedGitHubClient["client"], options: ScanOptions): Promise<ScanResult>;
  formatOutput(candidates: readonly SearchCandidate[], format: OutputFormat, options?: OutputOptions): string;
  createFileCache(): FileCache;
  loadSearchIntentCatalog(options?: { configDir?: string }): ReturnType<typeof loadSearchIntentCatalog>;
}

export function formatUsage(): string {
  return [
    "Usage: octosift <intent> [options] <user|owner/repo|github-url|@file> [...]",
    "",
    "Find candidate repositories for an explicit search intent from GitHub users, repositories, URLs, or input files.",
    "",
    "Search intents:",
    "  dotfiles                            Find dotfiles and dev-environment repositories",
    "  skills                              Find reusable AI-agent skill-pack repositories",
    "  <custom>                            Load additional intents from ./config or --config-dir",
    "",
    "Inputs:",
    "  LuisUrrutia                         GitHub username",
    "  LuisUrrutia/dotfiles                GitHub repository",
    "  https://github.com/LuisUrrutia      GitHub user URL",
    "  https://github.com/LuisUrrutia/repo GitHub repository URL",
    "  @path                               Read newline-delimited inputs from a file",
    "",
    "Options:",
    "  --format <json|csv>        Output format (default: json)",
    "  --file <path>              Read newline-delimited inputs from a file",
    "  --min-score <number>       Minimum candidate score, 0 or greater (default: 3)",
    "  --max-contributors <n>     Maximum human contributors per repository, 1 or greater (default: 50)",
    "  --max-repos <n>            Maximum repositories scanned per user, 1 or greater (default: unlimited)",
    "  --ignore-forks             Omit fork repositories from output",
    "  --verbose                 Include matched signals and source provenance in output",
    "  --no-cache                 Disable persistent GitHub API response cache",
    "  --cache-ttl <seconds>      Cache TTL in finite seconds, 0 or greater (default: 259200)",
    "  --config-dir <dir>         Load TOML search intent definitions from a config directory",
    "  --clear-cache              Clear persistent cache and exit",
    "  --help                     Show this help text",
    "  --version                  Show version",
    "",
    "Value flags also support --flag=value. Commands --help, --version, and --clear-cache are exclusive.",
  ].join("\n");
}

export async function runCli(args: string[], writers: Partial<CliWriters> = {}, dependencies: Partial<CliDependencies> = {}): Promise<ExitCode> {
  const resolvedWriters = resolveWriters(writers);
  const resolvedDependencies = resolveDependencies(dependencies);
  const parsed = parseCommandIntent(args);

  if ("errors" in parsed) {
    writeErrors(resolvedWriters, parsed.errors);
    return EXIT_CODE_INVALID_INPUT;
  }

  const { intent } = parsed;

  switch (intent.kind) {
    case "version":
      writeOutput(resolvedWriters, VERSION);
      return 0;
    case "help":
      writeOutput(resolvedWriters, formatUsage());
      return 0;
    case "clear-cache":
      await resolvedDependencies.createFileCache().clear();
      return 0;
    case "scan": {
      const catalog = await loadCatalog(resolvedWriters, resolvedDependencies, intent.configDir);
      if (catalog === undefined) {
        return EXIT_CODE_INVALID_INPUT;
      }

      const scorer = catalog.resolve(intent.searchIntent);
      if (scorer === undefined) {
        writeErrors(resolvedWriters, [`Unknown search intent: ${intent.searchIntent}. Available intents: ${catalog.intentNames.join(", ")}`]);
        return EXIT_CODE_INVALID_INPUT;
      }

      const expanded = await resolvedDependencies.expandInputArgs(intent.inputArgs);
      const normalized = await resolvedDependencies.normalizeInputs(expanded.values);
      const inputErrors = [...expanded.errors, ...normalized.errors];

      if (inputErrors.length > 0 || normalized.inputs.length === 0) {
        writeErrors(resolvedWriters, formatInputErrors(inputErrors, EMPTY_INPUT_ERROR));
        return EXIT_CODE_INVALID_INPUT;
      }

      const runtime = await configureRuntime(resolvedWriters, resolvedDependencies, intent.useCache, intent.cacheTtlSeconds);
      if (runtime === undefined) {
        return EXIT_CODE_INVALID_INPUT;
      }

      const result = await resolvedDependencies.scanInputs(normalized.inputs, runtime.client, {
        scorer,
        maxContributors: intent.maxContributors,
        maxRepos: intent.maxRepos,
      });
      const candidates = selectFinalCandidates(result.candidates, { minScore: intent.minScore, ignoreForks: intent.ignoreForks });

      writeOutput(resolvedWriters, resolvedDependencies.formatOutput(candidates, intent.format, { verbose: intent.verbose }));
      writeWarnings(resolvedWriters, result.warnings);

      return result.exitCode;
    }
  }
}

function resolveWriters(writers: Partial<CliWriters>): CliWriters {
  return {
    stdout: writers.stdout ?? ((value) => console.log(value)),
    stderr: writers.stderr ?? ((value) => console.error(value)),
  };
}

function resolveDependencies(dependencies: Partial<CliDependencies>): CliDependencies {
  return {
    expandInputArgs: expandCliInputArgs,
    normalizeInputs,
    createDefaultGitHubClient,
    scanInputs,
    formatOutput,
    createFileCache: () => new FileCache(),
    loadSearchIntentCatalog,
    ...dependencies,
  };
}

async function loadCatalog(
  writers: CliWriters,
  dependencies: CliDependencies,
  configDir: string | undefined,
): Promise<SearchIntentCatalog | undefined> {
  try {
    return await dependencies.loadSearchIntentCatalog({ configDir });
  } catch (error) {
    writeErrors(writers, [error instanceof Error ? error.message : String(error)]);
    return undefined;
  }
}

async function configureRuntime(
  writers: CliWriters,
  dependencies: CliDependencies,
  useCache: boolean,
  cacheTtlSeconds: number,
): Promise<SelectedGitHubClient | undefined> {
  try {
    const runtime = await prepareRuntime({ useCache, cacheTtlSeconds }, dependencies);
    writeWarnings(writers, runtime.warnings);
    return runtime;
  } catch (error) {
    writeErrors(writers, [formatClientConfigurationError(error)]);
    return undefined;
  }
}
