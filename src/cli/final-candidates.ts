import type { SearchCandidate } from "../domain/types";

export interface FinalCandidateSelectionOptions {
  minScore: number;
  ignoreForks: boolean;
}

export function selectFinalCandidates(
  candidates: readonly SearchCandidate[],
  options: FinalCandidateSelectionOptions,
): SearchCandidate[] {
  return [...candidates]
    .filter((candidate) => candidate.score >= options.minScore)
    .filter((candidate) => !options.ignoreForks || !candidate.isFork)
    .sort(compareFinalCandidates);
}

function compareFinalCandidates(left: SearchCandidate, right: SearchCandidate): number {
  const scoreComparison = right.score - left.score;

  if (scoreComparison !== 0) {
    return scoreComparison;
  }

  return timestampValue(right.pushedAt) - timestampValue(left.pushedAt);
}

function timestampValue(value: string | null): number {
  if (value === null) {
    return 0;
  }

  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp) ? timestamp : 0;
}
