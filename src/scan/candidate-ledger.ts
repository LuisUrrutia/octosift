import type { RepoMetadata } from "../domain/types";

export interface CandidateRepoEvent {
  repo: RepoMetadata;
  sourceUser: string;
  sourceInput: string;
}

export interface CandidateLedger {
  recordRepo(event: CandidateRepoEvent): void;
  toCandidateRepos(): CandidateRepo[];
}

export interface CandidateRepo {
  fullName: string;
  repo: RepoMetadata;
  sourceUser: readonly string[];
  sourceInput: readonly string[];
}

export function createCandidateLedger(): CandidateLedger {
  const candidates = new Map<string, CandidateRepo>();

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

      candidates.set(event.repo.fullName, buildCandidateRepo(event));
    },

    toCandidateRepos() {
      return [...candidates.values()].map(cloneCandidateRepo);
    },
  };
}

function buildCandidateRepo(event: CandidateRepoEvent): CandidateRepo {
  const repo = snapshotRepo(event.repo);

  return {
    fullName: repo.fullName,
    repo,
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
    size: repo.size,
    language: repo.language,
    isFork: repo.isFork,
    isArchived: repo.isArchived,
    updatedAt: repo.updatedAt,
    pushedAt: repo.pushedAt,
  };
}

function cloneCandidateRepo(candidate: CandidateRepo): CandidateRepo {
  return {
    ...candidate,
    repo: snapshotRepo(candidate.repo),
    sourceUser: [...candidate.sourceUser],
    sourceInput: [...candidate.sourceInput],
  };
}

function appendUnique(values: readonly string[], value: string): readonly string[] {
  if (values.includes(value)) {
    return values;
  }

  return [...values, value];
}
