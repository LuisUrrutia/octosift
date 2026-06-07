import type { DotfilesCandidate, MatchedSignal, RepoMetadata } from "../domain/types";
import { scoreRepoMetadata } from "../rules/scoring";

export interface CandidateRepoEvent {
  repo: RepoMetadata;
  sourceUser: string;
  sourceInput: string;
}

export interface CandidateLedger {
  recordRepo(event: CandidateRepoEvent): void;
  toCandidates(): DotfilesCandidate[];
}

export function createCandidateLedger(): CandidateLedger {
  const candidates = new Map<string, DotfilesCandidate>();

  return {
    recordRepo(event) {
      const existing = candidates.get(event.repo.fullName);

      if (existing !== undefined) {
        candidates.set(event.repo.fullName, {
          ...existing,
          sourceUser: appendUnique(existing.sourceUser, event.sourceUser),
          sourceInput: appendUnique(existing.sourceInput, event.sourceInput),
        });
        return;
      }

      candidates.set(event.repo.fullName, buildCandidate(event));
    },

    toCandidates() {
      return [...candidates.values()].map(cloneCandidate);
    },
  };
}

function buildCandidate(event: CandidateRepoEvent): DotfilesCandidate {
  const repo = snapshotRepo(event.repo);
  const score = scoreRepoMetadata(repo);

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
    sourceUser: [event.sourceUser],
    sourceInput: [event.sourceInput],
  };
}

function snapshotRepo(repo: RepoMetadata): RepoMetadata {
  return {
    owner: repo.owner,
    name: repo.name,
    fullName: repo.fullName,
    url: repo.url,
    description: repo.description,
    topics: [...repo.topics],
    stars: repo.stars,
    forks: repo.forks,
    language: repo.language,
    isFork: repo.isFork,
    isArchived: repo.isArchived,
    updatedAt: repo.updatedAt,
    pushedAt: repo.pushedAt,
  };
}

function cloneCandidate(candidate: DotfilesCandidate): DotfilesCandidate {
  return {
    ...candidate,
    topics: [...candidate.topics],
    matchedSignals: cloneMatchedSignals(candidate.matchedSignals),
    sourceUser: [...candidate.sourceUser],
    sourceInput: [...candidate.sourceInput],
  };
}

function cloneMatchedSignals(signals: readonly MatchedSignal[]): MatchedSignal[] {
  return signals.map((signal) => ({ ...signal }));
}

function appendUnique(values: readonly string[], value: string): readonly string[] {
  if (values.includes(value)) {
    return values;
  }

  return [...values, value];
}
