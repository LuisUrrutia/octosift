import type { Contributor, NormalizedInput, RepoMetadata, ScanResult } from "../domain/types";
import type { GitHubClient } from "../github/client";
import { isBotContributor } from "../rules/bots";
import { createCandidateLedger, type CandidateLedger } from "./candidate-ledger";
import { createScanOutcomePolicy, type ScanFailureDecision, type ScanOutcomePolicy } from "./scan-outcome-policy";

interface ScanCandidateLifecycleOptions {
  maxContributors?: number;
  maxRepos?: number;
}

interface ScanPolicy {
  maxContributors: number;
  maxRepos?: number;
}

const DEFAULT_MAX_CONTRIBUTORS = 50;

export async function scanCandidateLifecycle(
  inputs: readonly NormalizedInput[],
  client: GitHubClient,
  options: ScanCandidateLifecycleOptions,
): Promise<ScanResult> {
  const policy = normalizeScanPolicy(options);
  const candidateLedger = createCandidateLedger();
  const outcomePolicy = createScanOutcomePolicy();

  for (const input of inputs) {
    if (input.kind === "user") {
      const decision = await scanUser(input.login, input.login, input.login, client, candidateLedger, outcomePolicy, policy.maxRepos);

      if (decision === "stop") {
        return outcomePolicy.buildResult(candidateLedger.toCandidates());
      }

      continue;
    }

    if (input.kind === "repository") {
      const decision = await scanRepositoryInput(input, client, candidateLedger, outcomePolicy, policy);

      if (decision === "stop") {
        return outcomePolicy.buildResult(candidateLedger.toCandidates());
      }
    }
  }

  return outcomePolicy.buildResult(candidateLedger.toCandidates());
}

function normalizeScanPolicy(options: ScanCandidateLifecycleOptions): ScanPolicy {
  return {
    maxContributors: options.maxContributors ?? DEFAULT_MAX_CONTRIBUTORS,
    maxRepos: options.maxRepos,
  };
}

async function scanRepositoryInput(
  input: Extract<NormalizedInput, { kind: "repository" }>,
  client: GitHubClient,
  candidateLedger: CandidateLedger,
  outcomePolicy: ScanOutcomePolicy,
  policy: ScanPolicy,
): Promise<ScanFailureDecision> {
  let contributors: readonly Contributor[];

  try {
    contributors = await client.listRepoContributors(input.owner, input.name);
  } catch (error) {
    return outcomePolicy.recordFailure({ error, context: { input: input.fullName, repository: input.fullName } });
  }

  let humanCount = 0;

  for (const contributor of contributors) {
    if (isBotContributor(contributor)) {
      continue;
    }

    if (humanCount >= policy.maxContributors) {
      break;
    }

    humanCount += 1;

    const decision = await scanUser(
      contributor.login,
      contributor.login,
      input.fullName,
      client,
      candidateLedger,
      outcomePolicy,
      policy.maxRepos,
      input.fullName,
    );

    if (decision === "stop") {
      return "stop";
    }
  }

  return "continue";
}

async function scanUser(
  login: string,
  sourceUser: string,
  sourceInput: string,
  client: GitHubClient,
  candidateLedger: CandidateLedger,
  outcomePolicy: ScanOutcomePolicy,
  maxRepos: number | undefined,
  repository?: string,
): Promise<ScanFailureDecision> {
  let repos: readonly RepoMetadata[];

  try {
    repos = await client.listUserRepos(login);
  } catch (error) {
    return outcomePolicy.recordFailure({ error, context: { input: sourceInput, repository, contributor: login } });
  }

  const reposToScan = maxRepos === undefined ? repos : repos.slice(0, maxRepos);

  for (const repo of reposToScan) {
    candidateLedger.recordRepo({ repo, sourceUser, sourceInput });
  }

  return "continue";
}
