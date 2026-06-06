import type { ScanWarning } from "../domain/types";

export interface CliWriters {
  stdout(value: string): void;
  stderr(value: string): void;
}

export interface InputErrorMessage {
  message: string;
  source?: string;
}

export function writeOutput(writers: CliWriters, output: string): void {
  writers.stdout(output);
}

export function writeErrors(writers: CliWriters, errors: readonly string[]): void {
  for (const error of errors) {
    writers.stderr(error);
  }
}

export function writeWarnings(writers: CliWriters, warnings: readonly ScanWarning[]): void {
  for (const warning of warnings) {
    writers.stderr(formatWarning(warning));
  }
}

export function formatInputErrors(errors: readonly InputErrorMessage[], fallback: string): string[] {
  if (errors.length === 0) {
    return [fallback];
  }

  return errors.map((error) => error.source === undefined ? error.message : `${error.message} (${error.source})`);
}

export function formatClientConfigurationError(error: unknown): string {
  return `Could not configure GitHub client: ${formatUnknownError(error)}`;
}

function formatWarning(warning: ScanWarning): string {
  const details = [warning.input, warning.repository, warning.contributor].filter((value) => value !== undefined).join(" ");
  const retry = warning.retryAfterSeconds === undefined ? "" : ` retry-after=${warning.retryAfterSeconds}s`;
  const suffix = details.length === 0 ? retry : ` (${details})${retry}`;
  return `${warning.code}: ${warning.message}${suffix}`;
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
