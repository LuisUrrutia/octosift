import type { SearchCandidate } from "../domain/types";
import { formatCsvCandidates } from "./csv";
import { formatJsonCandidates } from "./json";
import type { OutputOptions } from "./schema";

export type OutputFormat = "json" | "csv";

export interface OutputFormatter {
  format(candidates: readonly SearchCandidate[], options?: OutputOptions): string;
}

const OUTPUT_FORMATTERS: Record<OutputFormat, OutputFormatter> = {
  json: {
    format: formatJsonCandidates,
  },
  csv: {
    format: formatCsvCandidates,
  },
};

export function formatOutput(candidates: readonly SearchCandidate[], format: OutputFormat, options: OutputOptions = {}): string {
  return OUTPUT_FORMATTERS[format].format(candidates, options);
}
