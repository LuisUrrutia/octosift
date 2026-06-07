import type { DotfilesCandidate } from "../domain/types";
import { projectOutputCandidates } from "./schema";

export function formatJsonCandidates(candidates: readonly DotfilesCandidate[]): string {
  return JSON.stringify(projectOutputCandidates(candidates));
}
