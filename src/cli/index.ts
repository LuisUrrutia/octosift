import { FileCache } from "../cache/file-cache";
import { EXIT_CODE_INVALID_INPUT, type DotfilesCandidate, type ExitCode, type ScanResult } from "../domain/types";
import { type SelectedGitHubClient } from "../github/client";
import { createDefaultGitHubClient } from "../github/select-client";
import { normalizeInputs, type NormalizeInputsOptions, type NormalizeInputsResult } from "../input/normalize";
import { formatOutput, type OutputFormat } from "../output/format";
import { scanInputs, type ScanOptions } from "../scan/scanner";
import { parseCommandIntent } from "./command-intent";
import {
  formatClientConfigurationError,
  formatInputErrors,
  type CliWriters,
  writeErrors,
  writeOutput,
  writeWarnings,
} from "./emission";
import { prepareRuntime } from "./runtime";

export const VERSION = "0.0.0";

const EMPTY_INPUT_ERROR = "At least one GitHub user, repository, URL, or input file is required.";

export type { CliWriters } from "./emission";

export interface CliDependencies {
  normalizeInputs(args: readonly string[], options?: NormalizeInputsOptions): Promise<NormalizeInputsResult>;
  createDefaultGitHubClient(): Promise<SelectedGitHubClient>;
  scanInputs(inputs: NormalizeInputsResult["inputs"], client: SelectedGitHubClient["client"], options: ScanOptions): Promise<ScanResult>;
  formatOutput(candidates: readonly DotfilesCandidate[], format: OutputFormat): string;
  createFileCache(): FileCache;
}

export function formatUsage(): string {
  return [
    "Usage: dotfiles-finder [options] <user|owner/repo|github-url|@file> [...]",
    "",
    "Find likely dotfiles repositories from GitHub users, repositories, URLs, or input files.",
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
    "  --no-cache                 Disable persistent GitHub API response cache",
    "  --cache-ttl <seconds>      Cache TTL in finite seconds, 0 or greater (default: 21600)",
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
      const normalized = await resolvedDependencies.normalizeInputs(intent.inputArgs);

      if (normalized.errors.length > 0 || normalized.inputs.length === 0) {
        writeErrors(resolvedWriters, formatInputErrors(normalized.errors, EMPTY_INPUT_ERROR));
        return EXIT_CODE_INVALID_INPUT;
      }

      const runtime = await configureRuntime(resolvedWriters, resolvedDependencies, intent.useCache, intent.cacheTtlSeconds);
      if (runtime === undefined) {
        return EXIT_CODE_INVALID_INPUT;
      }

      const result = await resolvedDependencies.scanInputs(normalized.inputs, runtime.client, {
        maxContributors: intent.maxContributors,
        maxRepos: intent.maxRepos,
      });
      const candidates = result.candidates.filter((candidate) => candidate.score >= intent.minScore);

      writeOutput(resolvedWriters, resolvedDependencies.formatOutput(candidates, intent.format));
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
    normalizeInputs,
    createDefaultGitHubClient,
    scanInputs,
    formatOutput,
    createFileCache: () => new FileCache(),
    ...dependencies,
  };
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
