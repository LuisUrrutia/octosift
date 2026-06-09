import type { NormalizedInput, ScanResult } from "../domain/types";
import type { GitHubClient } from "../github/client";
import type { SearchIntentScorer } from "../rules/scoring";
import { scanCandidateLifecycle } from "./scan-candidate-lifecycle";

export interface ScanOptions {
  scorer: SearchIntentScorer;
  maxContributors?: number;
  maxRepos?: number;
}

export async function scanInputs(inputs: readonly NormalizedInput[], client: GitHubClient, options: ScanOptions): Promise<ScanResult> {
  return scanCandidateLifecycle(inputs, client, options);
}
