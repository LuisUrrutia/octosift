import type { DotfilesCandidate } from "../domain/types";
import { serializeOutputCsvHeader, serializeOutputCsvRow } from "./schema";

export function formatCsvCandidates(candidates: readonly DotfilesCandidate[]): string {
  const header = serializeOutputCsvHeader();
  const rows = candidates.map(serializeOutputCsvRow);

  return [header, ...rows].join("\n");
}
