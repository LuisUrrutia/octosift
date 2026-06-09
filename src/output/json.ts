import type { SearchCandidate } from "../domain/types";
import { projectOutputCandidates, type OutputOptions } from "./schema";

export function formatJsonCandidates(candidates: readonly SearchCandidate[], options: OutputOptions = {}): string {
  return JSON.stringify(projectOutputCandidates(candidates, options));
}
