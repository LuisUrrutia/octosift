import type { OutputFormat } from "../output/format";

const DEFAULT_FORMAT: OutputFormat = "json";
const DEFAULT_MIN_SCORE = 3;
const DEFAULT_MAX_CONTRIBUTORS = 50;
const DEFAULT_CACHE_TTL_SECONDS = 21600;

type ExclusiveFlag = "--help" | "--version" | "--clear-cache";
type ScalarValueFlag = "--format" | "--min-score" | "--max-contributors" | "--max-repos" | "--cache-ttl";
type ValueFlag = ScalarValueFlag | "--file";

export type CommandIntent =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "clear-cache" }
  | {
    kind: "scan";
    inputArgs: string[];
    format: OutputFormat;
    minScore: number;
    maxContributors: number;
    maxRepos: number | undefined;
    useCache: boolean;
    cacheTtlSeconds: number;
  };

export type ParseCommandIntentResult = { intent: CommandIntent } | { errors: string[] };

export function parseCommandIntent(args: readonly string[]): ParseCommandIntentResult {
  if (args.length === 0) {
    return { intent: { kind: "help" } };
  }

  const inputArgs: string[] = [];
  const errors: string[] = [];
  const seenScalarFlags = new Set<ScalarValueFlag>();
  let exclusiveFlag: ExclusiveFlag | undefined;
  let multipleExclusiveErrorAdded = false;
  let exclusiveConflictAdded = false;
  let scanTokenSeen = false;
  let format: OutputFormat = DEFAULT_FORMAT;
  let minScore = DEFAULT_MIN_SCORE;
  let maxContributors = DEFAULT_MAX_CONTRIBUTORS;
  let maxRepos: number | undefined;
  let useCache = true;
  let cacheTtlSeconds = DEFAULT_CACHE_TTL_SECONDS;

  const markScanToken = () => {
    scanTokenSeen = true;
    if (exclusiveFlag !== undefined && !exclusiveConflictAdded) {
      errors.push(`${exclusiveFlag} cannot be combined with scan inputs or flags`);
      exclusiveConflictAdded = true;
    }
  };

  const registerExclusive = (flag: ExclusiveFlag) => {
    if (exclusiveFlag !== undefined && !multipleExclusiveErrorAdded) {
      errors.push("Only one exclusive command can be used: --help, --version, or --clear-cache");
      multipleExclusiveErrorAdded = true;
    }
    if (exclusiveFlag === undefined) {
      exclusiveFlag = flag;
    }
    if (scanTokenSeen && !exclusiveConflictAdded) {
      errors.push(`${exclusiveFlag} cannot be combined with scan inputs or flags`);
      exclusiveConflictAdded = true;
    }
  };

  const registerScalarFlag = (flag: ScalarValueFlag): boolean => {
    if (seenScalarFlags.has(flag)) {
      errors.push(`Duplicate ${flag}.`);
      return false;
    }
    seenScalarFlags.add(flag);
    return true;
  };

  for (let index = 0; index < args.length; index += 1) {
    const rawArg = args[index];
    const parsed = parseFlagToken(rawArg);

    if (parsed !== undefined && isExclusiveFlag(parsed.flag)) {
      if (parsed.hasEquals) {
        errors.push(`${parsed.flag} does not take a value.`);
        continue;
      }
      registerExclusive(parsed.flag);
      continue;
    }

    if (parsed !== undefined && parsed.flag === "--no-cache") {
      if (parsed.hasEquals) {
        errors.push("--no-cache does not take a value.");
        continue;
      }
      markScanToken();
      useCache = false;
      continue;
    }

    if (parsed !== undefined && isValueFlag(parsed.flag)) {
      markScanToken();
      const valueResult = readValue(args, index, parsed.flag, parsed.value, parsed.hasEquals, errors);
      if (!parsed.hasEquals && valueResult !== undefined) {
        index += 1;
      }
      if (valueResult === undefined) {
        continue;
      }

      if (parsed.flag === "--file") {
        inputArgs.push("--file", valueResult);
        continue;
      }

      const firstOccurrence = registerScalarFlag(parsed.flag);
      switch (parsed.flag) {
        case "--format": {
          const parsedFormat = parseFormat(valueResult, errors);
          if (firstOccurrence && parsedFormat !== undefined) {
            format = parsedFormat;
          }
          break;
        }
        case "--min-score": {
          const parsedNumber = parseNumberFlag(valueResult, parsed.flag, { allowZero: true, integer: false });
          if (typeof parsedNumber === "string") {
            errors.push(parsedNumber);
          } else if (firstOccurrence) {
            minScore = parsedNumber;
          }
          break;
        }
        case "--max-contributors": {
          const parsedNumber = parseNumberFlag(valueResult, parsed.flag, { allowZero: false, integer: true });
          if (typeof parsedNumber === "string") {
            errors.push(parsedNumber);
          } else if (firstOccurrence) {
            maxContributors = parsedNumber;
          }
          break;
        }
        case "--max-repos": {
          const parsedNumber = parseNumberFlag(valueResult, parsed.flag, { allowZero: false, integer: true });
          if (typeof parsedNumber === "string") {
            errors.push(parsedNumber);
          } else if (firstOccurrence) {
            maxRepos = parsedNumber;
          }
          break;
        }
        case "--cache-ttl": {
          const parsedNumber = parseNumberFlag(valueResult, parsed.flag, { allowZero: true, integer: true });
          if (typeof parsedNumber === "string") {
            errors.push(parsedNumber);
          } else if (firstOccurrence) {
            cacheTtlSeconds = parsedNumber;
          }
          break;
        }
      }
      continue;
    }

    if (rawArg.startsWith("-")) {
      errors.push(`Unknown option: ${rawArg}`);
      continue;
    }

    markScanToken();
    inputArgs.push(rawArg);
  }

  if (errors.length > 0) {
    return { errors };
  }

  if (exclusiveFlag !== undefined) {
    return { intent: exclusiveIntentFor(exclusiveFlag) };
  }

  return { intent: { kind: "scan", inputArgs, format, minScore, maxContributors, maxRepos, useCache, cacheTtlSeconds } };
}

function parseFlagToken(arg: string): { flag: string; value: string | undefined; hasEquals: boolean } | undefined {
  if (!arg.startsWith("--")) {
    return undefined;
  }

  const equalsIndex = arg.indexOf("=");
  if (equalsIndex === -1) {
    return { flag: arg, value: undefined, hasEquals: false };
  }

  return { flag: arg.slice(0, equalsIndex), value: arg.slice(equalsIndex + 1), hasEquals: true };
}

function isExclusiveFlag(flag: string): flag is ExclusiveFlag {
  return flag === "--help" || flag === "--version" || flag === "--clear-cache";
}

function isValueFlag(flag: string): flag is ValueFlag {
  return flag === "--format"
    || flag === "--file"
    || flag === "--min-score"
    || flag === "--max-contributors"
    || flag === "--max-repos"
    || flag === "--cache-ttl";
}

function readValue(
  args: readonly string[],
  index: number,
  flag: ValueFlag,
  equalsValue: string | undefined,
  hasEquals: boolean,
  errors: string[],
): string | undefined {
  if (hasEquals) {
    if (equalsValue === undefined || equalsValue.trim().length === 0) {
      errors.push(`Missing value for ${flag}.`);
      return undefined;
    }
    return equalsValue;
  }

  const value = args[index + 1];
  if (value === undefined || value.trim().length === 0 || value.startsWith("--")) {
    errors.push(`Missing value for ${flag}.`);
    return undefined;
  }

  return value;
}

function parseFormat(value: string, errors: string[]): OutputFormat | undefined {
  if (value === "json" || value === "csv") {
    return value;
  }

  errors.push("--format must be one of: json, csv");
  return undefined;
}

function parseNumberFlag(value: string, flag: ScalarValueFlag, options: { allowZero: boolean; integer: boolean }): number | string {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || (options.integer && !Number.isInteger(parsed)) || parsed < 0 || (!options.allowZero && parsed === 0)) {
    const lowerBound = options.allowZero ? "0 or greater" : "1 or greater";
    const kind = options.integer ? "integer" : "number";
    return `Invalid ${flag} value: ${value}. Expected a finite ${kind} ${lowerBound}.`;
  }

  return parsed;
}

function exclusiveIntentFor(flag: ExclusiveFlag): CommandIntent {
  switch (flag) {
    case "--help":
      return { kind: "help" };
    case "--version":
      return { kind: "version" };
    case "--clear-cache":
      return { kind: "clear-cache" };
  }
}
