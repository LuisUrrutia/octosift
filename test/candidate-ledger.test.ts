import { expect, test } from "bun:test";

import { createCandidateLedger } from "../src/scan/candidate-ledger";
import { cloneRepo, GITHUB_FIXTURE_REPOS } from "./fixtures/github";

test("candidate ledger records repository identity and source provenance", () => {
  const ledger = createCandidateLedger();

  ledger.recordRepo({ repo: cloneRepo(GITHUB_FIXTURE_REPOS[0]), sourceUser: "alice", sourceInput: "alice" });

  const [candidate] = ledger.toCandidateRepos();

  expect(candidate.fullName).toBe("alice/dotfiles");
  expect(candidate.repo.fullName).toBe("alice/dotfiles");
  expect(candidate.repo.description).toBe("Opinionated dotfiles for macOS and Linux");
  expect(candidate.sourceUser).toEqual(["alice"]);
  expect(candidate.sourceInput).toEqual(["alice"]);
  expect("score" in candidate).toBe(false);
  expect("matchedSignals" in candidate).toBe(false);
});

test("candidate ledger owns first-seen order, dedupe, provenance order, and snapshots", () => {
  const ledger = createCandidateLedger();
  const firstRepo = cloneRepo(GITHUB_FIXTURE_REPOS[0]);

  ledger.recordRepo({ repo: firstRepo, sourceUser: "alice", sourceInput: "alice" });
  firstRepo.description = "mutated description";
  (firstRepo.topics as string[]).push("mutated-topic");

  ledger.recordRepo({ repo: cloneRepo(GITHUB_FIXTURE_REPOS[2]), sourceUser: "alice", sourceInput: "alice" });
  ledger.recordRepo({ repo: cloneRepo(GITHUB_FIXTURE_REPOS[0]), sourceUser: "bob", sourceInput: "bob/config" });
  ledger.recordRepo({ repo: cloneRepo(GITHUB_FIXTURE_REPOS[0]), sourceUser: "alice", sourceInput: "alice" });

  const candidates = ledger.toCandidateRepos();

  expect(candidates.map((candidate) => candidate.fullName)).toEqual(["alice/dotfiles", "shared/shared-dotfiles"]);
  expect(candidates[0].repo.description).toBe("Opinionated dotfiles for macOS and Linux");
  expect(candidates[0].repo.topics).toEqual(["dotfiles", "stow", "zsh"]);
  expect(candidates[0].sourceUser).toEqual(["alice", "bob"]);
  expect(candidates[0].sourceInput).toEqual(["alice", "bob/config"]);

  (candidates[0].repo.topics as string[]).push("external-mutation");
  (candidates[0].sourceUser as string[]).push("mallory");

  const freshCandidates = ledger.toCandidateRepos();
  expect(freshCandidates[0].repo.topics).toEqual(["dotfiles", "stow", "zsh"]);
  expect(freshCandidates[0].sourceUser).toEqual(["alice", "bob"]);
});

test("candidate ledger export surface and dependencies stay narrow", async () => {
  const exports = await import("../src/scan/candidate-ledger");
  const source = await Bun.file(new URL("../src/scan/candidate-ledger.ts", import.meta.url).pathname).text();

  expect(Object.keys(exports).sort()).toEqual(["createCandidateLedger"]);
  expect(source.includes("../rules/scoring")).toBe(false);
  expect(source.includes("SearchIntent")).toBe(false);
  expect(source.includes("SearchCandidate")).toBe(false);
  expect(source.includes("MatchedSignal")).toBe(false);
  expect(source.includes("createSearchIntentScorer")).toBe(false);
  expect(source.includes("../github/")).toBe(false);
  expect(source.includes("../input/")).toBe(false);
  expect(source.includes("../rules/bots")).toBe(false);
  expect(source.includes("./scan-outcome-policy")).toBe(false);
});
