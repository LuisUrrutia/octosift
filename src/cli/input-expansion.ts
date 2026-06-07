import type { InputNormalizationError } from "../input/normalize";

export type ReadCliInputFile = (path: string) => string | Promise<string>;

interface BunFileReader {
  file(path: string): {
    text(): Promise<string>;
  };
}

export interface CliInputValue {
  value: string;
  source?: string;
}

export interface ExpandCliInputArgsOptions {
  readFile?: ReadCliInputFile;
}

export interface ExpandCliInputArgsResult {
  values: CliInputValue[];
  errors: InputNormalizationError[];
}

export async function expandCliInputArgs(
  args: readonly string[],
  options: ExpandCliInputArgsOptions = {},
): Promise<ExpandCliInputArgsResult> {
  const readFile = options.readFile ?? readTextFile;
  const values: CliInputValue[] = [];
  const errors: InputNormalizationError[] = [];

  const expandFile = async (path: string, source: string): Promise<void> => {
    try {
      const text = await readFile(path);
      for (const line of text.split(/\r?\n/)) {
        const trimmedLine = line.trim();

        if (trimmedLine.length === 0 || trimmedLine.startsWith("#")) {
          continue;
        }

        values.push({ value: trimmedLine, source });
      }
    } catch {
      errors.push({
        code: "file-read-failed",
        input: path,
        message: `Could not read input file: ${path}`,
        source,
      });
    }
  };

  for (let index = 0; index < args.length; index += 1) {
    const rawArg = args[index];

    if (rawArg === "--file") {
      const path = args[index + 1];

      if (path === undefined || path.trim().length === 0) {
        errors.push({
          code: "missing-file-path",
          input: rawArg,
          message: "Missing path after --file",
        });
        continue;
      }

      await expandFile(path, rawArg);
      index += 1;
      continue;
    }

    if (rawArg.startsWith("@")) {
      const path = rawArg.slice(1);

      if (path.trim().length === 0) {
        errors.push({
          code: "missing-file-path",
          input: rawArg,
          message: "Missing path after @",
        });
        continue;
      }

      await expandFile(path, rawArg);
      continue;
    }

    values.push({ value: rawArg });
  }

  return { values, errors };
}

async function readTextFile(path: string): Promise<string> {
  const bun = (globalThis as typeof globalThis & { Bun?: BunFileReader }).Bun;

  if (bun === undefined) {
    throw new Error("Bun file reader is unavailable");
  }

  return bun.file(path).text();
}
