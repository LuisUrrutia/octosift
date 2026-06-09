import type { MatchedSignal, RepoMetadata, SearchIntent } from "../domain/types";

export interface RepoScoreResult {
  score: number;
  matchedSignals: readonly MatchedSignal[];
}

export type ScoringField = "name" | "description" | "topics";
export type NormalizationChoice = "lowercase" | "lowercase-separators";

export interface ExactNameBoostDefinition {
  name: string;
  score: number;
  label: string;
  key?: string;
  dedupeTerm?: string;
}

export interface WeightedTermGroupDefinition {
  label: string;
  score: number;
  terms: readonly string[];
  fields: readonly ScoringField[];
  dedupe?: boolean;
}

export interface SearchIntentDefinition {
  name: SearchIntent;
  normalization: NormalizationChoice;
  exactNameBoosts: readonly ExactNameBoostDefinition[];
  termGroups: readonly WeightedTermGroupDefinition[];
  forkPenalty: number;
  archivedPenalty: number;
  clampMinScore: number;
}

export interface SearchIntentScorer {
  score(repo: RepoMetadata): RepoScoreResult;
}

export function createSearchIntentScorer(searchIntent: SearchIntent): SearchIntentScorer {
  if (searchIntent === "dotfiles") {
    return createDefinitionScorer(DOTFILES_SEARCH_INTENT_DEFINITION);
  }

  if (searchIntent === "skills") {
    return createDefinitionScorer(SKILLS_SEARCH_INTENT_DEFINITION);
  }

  throw new Error(`Unknown search intent: ${searchIntent}`);
}

export function createDefinitionScorer(definition: SearchIntentDefinition): SearchIntentScorer {
  return { score: (repo) => scoreWithDefinition(repo, definition) };
}

export function scoreRepoMetadata(repo: RepoMetadata): RepoScoreResult {
  return scoreWithDefinition(repo, DOTFILES_SEARCH_INTENT_DEFINITION);
}

export function scoreSkillsRepoMetadata(repo: RepoMetadata): RepoScoreResult {
  return scoreWithDefinition(repo, SKILLS_SEARCH_INTENT_DEFINITION);
}

export const DOTFILES_SEARCH_INTENT_DEFINITION: SearchIntentDefinition = {
  name: "dotfiles",
  normalization: "lowercase",
  exactNameBoosts: [
    { name: "dotfiles", score: 10, label: "exact dotfiles repository name", dedupeTerm: "dotfiles" },
    { name: ".dotfiles", score: 10, label: "exact dotfiles repository name", key: ".dotfiles", dedupeTerm: "dotfiles" },
  ],
  termGroups: [
    { label: "strong name signal", score: 5, terms: ["dotfiles", ".files", "chezmoi", "home-manager", "nix-config", "nvim-config", "stow"], fields: ["name"] },
    { label: "medium name/topic signal", score: 3, terms: ["nvim", "neovim", "vimrc", "zsh", "zshrc", "tmux", "config", "configs", "stow", "brewfile", "terminal", "shell"], fields: ["name", "topics"] },
    { label: "weak description/topic signal", score: 1, terms: ["setup", "macos", "linux", "developer environment", "dev environment", "workstation", "bootstrap", "install"], fields: ["description", "topics"] },
  ],
  forkPenalty: -1,
  archivedPenalty: -2,
  clampMinScore: 0,
};

export const SKILLS_SEARCH_INTENT_DEFINITION: SearchIntentDefinition = {
  name: "skills",
  normalization: "lowercase-separators",
  exactNameBoosts: [
    { name: "skill", score: 10, label: "exact skills repository name" },
    { name: "skills", score: 10, label: "exact skills repository name" },
  ],
  termGroups: [
    { label: "strong agent-skill metadata signal", score: 5, terms: ["agent skills", "claude skills", "opencode skills", "ai agent workflows", "mcp skills"], fields: ["name", "description", "topics"], dedupe: false },
    { label: "medium agent-skill metadata signal", score: 3, terms: ["agent skill", "claude skill", "opencode skill", "ai-agent skill", "ai agent skill", "agent workflow skill", "mcp skill"], fields: ["name", "description", "topics"] },
  ],
  forkPenalty: -1,
  archivedPenalty: -2,
  clampMinScore: 0,
};

function scoreWithDefinition(repo: RepoMetadata, definition: SearchIntentDefinition): RepoScoreResult {
  const name = normalize(repo.name, definition.normalization);
  const description = normalize(repo.description ?? "", definition.normalization);
  const topics = repo.topics.map((topic) => normalize(topic, definition.normalization));
  const matchedSignals: MatchedSignal[] = [];
  let score = 0;
  const matchedTerms = new Set<string>();

  for (const exactName of definition.exactNameBoosts) {
    const normalizedExactName = normalize(exactName.name, definition.normalization);
    if (name === normalizedExactName) {
      score += exactName.score;
      matchedSignals.push(buildSignal(exactName.key ?? normalizedExactName, exactName.label, exactName.score, `name exactly "${normalizedExactName}"`));
      matchedTerms.add(exactName.dedupeTerm ?? normalizedExactName);
      break;
    }
  }

  for (const group of definition.termGroups) {
    for (const rawTerm of group.terms) {
      const term = normalize(rawTerm, definition.normalization);
      if (group.dedupe !== false && matchedTerms.has(term)) {
        continue;
      }

      const match = findFieldMatch({ name, description, topics }, term, group.fields);
      if (match !== undefined) {
        score += group.score;
        matchedSignals.push(buildSignal(term, group.label, group.score, match));
        matchedTerms.add(term);
      }
    }
  }

  if (repo.isFork) {
    score += definition.forkPenalty;
    matchedSignals.push(buildSignal("fork", "fork penalty", definition.forkPenalty, "repository is a fork"));
  }

  if (repo.isArchived) {
    score += definition.archivedPenalty;
    matchedSignals.push(buildSignal("archived", "archived penalty", definition.archivedPenalty, "repository is archived"));
  }

  return {
    score: Math.max(definition.clampMinScore, score),
    matchedSignals,
  };
}

function buildSignal(key: string, label: string, score: number, evidence: string): MatchedSignal {
  return { key, label, score, evidence };
}

function normalize(value: string, normalization: NormalizationChoice): string {
  const lower = value.toLowerCase();
  if (normalization === "lowercase-separators") {
    return lower.replaceAll(/[-_]+/g, " ");
  }

  return lower;
}

function matchesText(haystack: string, term: string): boolean {
  return haystack.includes(term);
}

function findFieldMatch(
  repoText: { name: string; description: string; topics: readonly string[] },
  term: string,
  fields: readonly ScoringField[],
): string | undefined {
  for (const field of fields) {
    if (field === "name" && matchesText(repoText.name, term)) {
      return `name includes "${term}"`;
    }

    if (field === "description" && matchesText(repoText.description, term)) {
      return `description includes "${term}"`;
    }

    if (field === "topics" && repoText.topics.some((topic) => matchesText(topic, term))) {
      return `topics include "${term}"`;
    }
  }

  return undefined;
}
