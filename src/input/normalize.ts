import type { NormalizedInput, RepositoryRef, UserRef } from "../domain/types";

export type InputNormalizationErrorCode = "invalid-input" | "missing-file-path" | "file-read-failed";

export interface InputNormalizationError {
  code: InputNormalizationErrorCode;
  input: string;
  message: string;
  source?: string;
}

export interface GitHubInputValue {
  value: string;
  source?: string;
}

export type NormalizeInputValue = string | GitHubInputValue;

export type NormalizeInputsOptions = Record<never, never>;

export interface NormalizeInputsResult {
  inputs: NormalizedInput[];
  errors: InputNormalizationError[];
}

const GITHUB_HOST = "github.com";
const USERNAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPOSITORY_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

export async function normalizeInputs(
  values: readonly NormalizeInputValue[],
  _options: NormalizeInputsOptions = {},
): Promise<NormalizeInputsResult> {
  const inputs: NormalizedInput[] = [];
  const errors: InputNormalizationError[] = [];
  const seen = new Set<string>();

  const addInput = (input: UserRef | RepositoryRef): void => {
    const key = input.kind === "user" ? `user:${input.login.toLowerCase()}` : `repository:${input.fullName.toLowerCase()}`;

    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    inputs.push(input);
  };

  const addParsedInput = (rawInput: string, source?: string): void => {
    const parsed = parseGitHubInput(rawInput, source);

    if ("error" in parsed) {
      errors.push(parsed.error);
      return;
    }

    addInput(parsed.input);
  };

  for (const rawValue of values) {
    const inputValue = typeof rawValue === "string" ? { value: rawValue } : rawValue;
    addParsedInput(inputValue.value, inputValue.source);
  }

  return { inputs, errors };
}

type ParsedInput = { input: UserRef | RepositoryRef } | { error: InputNormalizationError };

function parseGitHubInput(rawInput: string, source?: string): ParsedInput {
  const input = rawInput.trim();

  if (input.length === 0) {
    return invalidInput(rawInput, source);
  }

  if (isHttpUrl(input)) {
    return parseGitHubUrl(input, source);
  }

  const parts = input.split("/");

  if (parts.length === 1 && isValidUsername(parts[0])) {
    return { input: createUserRef(parts[0]) };
  }

  if (parts.length === 2) {
    const owner = parts[0];
    const name = stripGitSuffix(parts[1]);

    if (isValidUsername(owner) && isValidRepositoryName(name)) {
      return { input: createRepositoryRef(owner, name) };
    }
  }

  return invalidInput(rawInput, source);
}

function parseGitHubUrl(rawInput: string, source?: string): ParsedInput {
  let url: URL;

  try {
    url = new URL(rawInput);
  } catch {
    return invalidInput(rawInput, source);
  }

  if (url.hostname.toLowerCase() !== GITHUB_HOST) {
    return invalidInput(rawInput, source);
  }

  const parts = url.pathname.split("/").filter((part) => part.length > 0);
  const owner = parts[0];

  if (owner === undefined || !isValidUsername(owner)) {
    return invalidInput(rawInput, source);
  }

  const rawName = parts[1];

  if (rawName === undefined) {
    return { input: createUserRef(owner) };
  }

  const name = stripGitSuffix(rawName);

  if (!isValidRepositoryName(name)) {
    return invalidInput(rawInput, source);
  }

  return { input: createRepositoryRef(owner, name) };
}

function createUserRef(login: string): UserRef {
  return {
    kind: "user",
    login,
    url: `https://github.com/${login}`,
  };
}

function createRepositoryRef(owner: string, name: string): RepositoryRef {
  return {
    kind: "repository",
    owner,
    name,
    fullName: `${owner}/${name}`,
    url: `https://github.com/${owner}/${name}`,
  };
}

function stripGitSuffix(value: string): string {
  return value.endsWith(".git") ? value.slice(0, -4) : value;
}

function isHttpUrl(value: string): boolean {
  return value.startsWith("https://") || value.startsWith("http://");
}

function isValidUsername(value: string): boolean {
  return USERNAME_PATTERN.test(value);
}

function isValidRepositoryName(value: string): boolean {
  return value.length > 0 && REPOSITORY_NAME_PATTERN.test(value);
}

function invalidInput(input: string, source?: string): { error: InputNormalizationError } {
  return {
    error: {
      code: "invalid-input",
      input,
      message: `Invalid GitHub input: ${input}`,
      source,
    },
  };
}
