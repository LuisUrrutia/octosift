import type { NormalizedInput, ScanResult } from "../domain/types";
import type { GitHubClient } from "../github/client";
import { scanCandidateLifecycle } from "./scan-candidate-lifecycle";

export interface ScanOptions {
  maxContributors?: number;
  maxRepos?: number;
}

export async function scanInputs(inputs: readonly NormalizedInput[], client: GitHubClient, options: ScanOptions = {}): Promise<ScanResult> {
  return scanCandidateLifecycle(inputs, client, options);
}
