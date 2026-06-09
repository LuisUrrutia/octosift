import type { Contributor, MatchedSignal, NormalizedInput, RepoMetadata, ScanResult, SearchCandidate } from "../domain/types";
import type { GitHubClient } from "../github/client";
import { isBotContributor } from "../rules/bots";
import type { SearchIntentScorer } from "../rules/scoring";
import { createCandidateLedger, type CandidateLedger, type CandidateRepo } from "./candidate-ledger";
import { createScanOutcomePolicy, type ScanFailureDecision, type ScanOutcomePolicy } from "./scan-outcome-policy";

interface ScanCandidateLifecycleOptions {
  scorer: SearchIntentScorer;
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
        return buildScanResult(candidateLedger, options.scorer, outcomePolicy);
      }

      continue;
    }

    if (input.kind === "repository") {
      const decision = await scanRepositoryInput(input, client, candidateLedger, outcomePolicy, policy);

      if (decision === "stop") {
        return buildScanResult(candidateLedger, options.scorer, outcomePolicy);
      }
    }
  }

  return buildScanResult(candidateLedger, options.scorer, outcomePolicy);
}

function normalizeScanPolicy(options: ScanCandidateLifecycleOptions): ScanPolicy {
  return {
    maxContributors: options.maxContributors ?? DEFAULT_MAX_CONTRIBUTORS,
    maxRepos: options.maxRepos,
  };
}

function buildScanResult(candidateLedger: CandidateLedger, scorer: SearchIntentScorer, outcomePolicy: ScanOutcomePolicy): ScanResult {
  return outcomePolicy.buildResult(candidateLedger.toCandidateRepos().map((candidateRepo) => buildSearchCandidate(candidateRepo, scorer)));
}

function buildSearchCandidate(candidateRepo: CandidateRepo, scorer: SearchIntentScorer): SearchCandidate {
  const score = scorer.score(candidateRepo.repo);
  const repo = candidateRepo.repo;

  return {
    url: repo.url,
    owner: repo.owner,
    name: repo.name,
    fullName: repo.fullName,
    description: repo.description,
    topics: [...repo.topics],
    stars: repo.stars,
    forks: repo.forks,
    language: repo.language,
    isFork: repo.isFork,
    isArchived: repo.isArchived,
    updatedAt: repo.updatedAt,
    pushedAt: repo.pushedAt,
    matchedSignals: cloneMatchedSignals(score.matchedSignals),
    score: score.score,
    sourceUser: [...candidateRepo.sourceUser],
    sourceInput: [...candidateRepo.sourceInput],
  };
}

function cloneMatchedSignals(signals: readonly MatchedSignal[]): MatchedSignal[] {
  return signals.map((signal) => ({ ...signal }));
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
    if (repo.size === 0) {
      continue;
    }

    candidateLedger.recordRepo({ repo, sourceUser, sourceInput });
  }

  return "continue";
}
