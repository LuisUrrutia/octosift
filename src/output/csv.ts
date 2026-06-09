import type { SearchCandidate } from "../domain/types";
import { serializeOutputCsvHeader, serializeOutputCsvRow, type OutputOptions } from "./schema";

export function formatCsvCandidates(candidates: readonly SearchCandidate[], options: OutputOptions = {}): string {
  const header = serializeOutputCsvHeader(options);
  const rows = candidates.map((candidate) => serializeOutputCsvRow(candidate, options));

  return [header, ...rows].join("\n");
}
