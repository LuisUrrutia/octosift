import { expect, test } from "bun:test";

import { SEARCH_CANDIDATE_FIELDS, type SearchCandidate } from "../src/domain/types";
import { formatCsvCandidates } from "../src/output/csv";
import { formatOutput } from "../src/output/format";
import { formatJsonCandidates } from "../src/output/json";
import { projectOutputCandidate, serializeOutputCsvRow } from "../src/output/schema";

const DEFAULT_OUTPUT_FIELDS = [
  "url",
  "fullName",
  "description",
  "stars",
  "forks",
  "language",
  "isFork",
  "isArchived",
  "updatedAt",
  "pushedAt",
  "score",
] as const;

const candidate: SearchCandidate = {
  url: "https://github.com/alice/dotfiles",
  owner: "alice",
  name: "dotfiles",
  fullName: "alice/dotfiles",
  description: "Line one, with a quote: \"value\"\nLine two",
  topics: ["dotfiles", "zsh", "stow"],
  stars: 42,
  forks: 7,
  language: "Shell",
  isFork: false,
  isArchived: false,
  updatedAt: "2026-05-25T10:00:00Z",
  pushedAt: "2026-05-25T09:30:00Z",
  matchedSignals: [
    {
      key: "topics",
      label: "topic match",
      score: 4,
      evidence: "topics include dotfiles",
    },
    {
      key: "stow",
      label: "signal match",
      score: 5,
      evidence: "README mentions stow, zsh, and dotfiles",
    },
  ],
  score: 9,
  sourceUser: ["alice", "bob"],
  sourceInput: ["alice", "https://github.com/alice"],
};

test("json formatter hides verbose fields by default", () => {
  const output = formatJsonCandidates([candidate]);
  const parsed = JSON.parse(output) as Record<string, unknown>[];
  const firstCandidate = parsed[0] ?? {};

  expect(Array.isArray(parsed)).toBe(true);
  expect(Object.keys(firstCandidate)).toEqual([...DEFAULT_OUTPUT_FIELDS]);
  expect("owner" in firstCandidate).toBe(false);
  expect("name" in firstCandidate).toBe(false);
  expect("topics" in firstCandidate).toBe(false);
  expect("matchedSignals" in firstCandidate).toBe(false);
  expect("sourceUser" in firstCandidate).toBe(false);
  expect("sourceInput" in firstCandidate).toBe(false);
});

test("json formatter includes verbose fields when requested", () => {
  const output = formatJsonCandidates([candidate], { verbose: true });
  const parsed = JSON.parse(output) as Record<string, unknown>[];
  const firstCandidate = parsed[0] ?? {};

  expect(Object.keys(firstCandidate)).toEqual([...SEARCH_CANDIDATE_FIELDS]);
  expect(firstCandidate.matchedSignals).toEqual([
    {
      key: "topics",
      label: "topic match",
      score: 4,
      evidence: "topics include dotfiles",
    },
    {
      key: "stow",
      label: "signal match",
      score: 5,
      evidence: "README mentions stow, zsh, and dotfiles",
    },
  ]);
  expect(firstCandidate.sourceUser).toEqual(candidate.sourceUser);
  expect(firstCandidate.sourceInput).toEqual(candidate.sourceInput);
});

test("output schema projects default and verbose field orders", () => {
  const projectedDefault = projectOutputCandidate(candidate);
  const projectedVerbose = projectOutputCandidate(candidate, { verbose: true });

  expect(Object.keys(projectedDefault)).toEqual([...DEFAULT_OUTPUT_FIELDS]);
  expect(Object.keys(projectedVerbose)).toEqual([...SEARCH_CANDIDATE_FIELDS]);
  expect("owner" in projectedDefault).toBe(false);
  expect("name" in projectedDefault).toBe(false);
  expect("topics" in projectedDefault).toBe(false);
  expect("matchedSignals" in projectedDefault).toBe(false);
  expect(projectedVerbose.matchedSignals).toEqual([
    {
      key: "topics",
      label: "topic match",
      score: 4,
      evidence: "topics include dotfiles",
    },
    {
      key: "stow",
      label: "signal match",
      score: 5,
      evidence: "README mentions stow, zsh, and dotfiles",
    },
  ]);
  expect(projectedVerbose.matchedSignals).not.toBe(candidate.matchedSignals);
});

test("csv formatter hides verbose fields by default and escapes cells", () => {
  const output = formatCsvCandidates([candidate]);
  const expected = [
    DEFAULT_OUTPUT_FIELDS.join(","),
    [
      "https://github.com/alice/dotfiles",
      "alice/dotfiles",
      ["\"Line one, with a quote: \"\"value\"\"", "Line two\""].join("\n"),
      "42",
      "7",
      "Shell",
      "false",
      "false",
      "2026-05-25T10:00:00Z",
      "2026-05-25T09:30:00Z",
      "9",
    ].join(","),
  ].join("\n");

  expect(output).toBe(expected);
  expect(output.startsWith(DEFAULT_OUTPUT_FIELDS.join(","))).toBe(true);
  expect(output.includes("dotfiles;zsh;stow")).toBe(false);
  expect(output.includes("alice;bob")).toBe(false);
  expect(output.includes("alice;https://github.com/alice")).toBe(false);
});

test("csv formatter includes verbose fields when requested", () => {
  const output = formatCsvCandidates([candidate], { verbose: true });
  const expected = [
    SEARCH_CANDIDATE_FIELDS.join(","),
    [
      "https://github.com/alice/dotfiles",
      "alice",
      "dotfiles",
      "alice/dotfiles",
      ["\"Line one, with a quote: \"\"value\"\"", "Line two\""].join("\n"),
      "dotfiles;zsh;stow",
      "42",
      "7",
      "Shell",
      "false",
      "false",
      "2026-05-25T10:00:00Z",
      "2026-05-25T09:30:00Z",
      '"topics|topic match|4|topics include dotfiles;stow|signal match|5|README mentions stow, zsh, and dotfiles"',
      "9",
      "alice;bob",
      "alice;https://github.com/alice",
    ].join(","),
  ].join("\n");

  expect(output).toBe(expected);
  expect(output.startsWith(SEARCH_CANDIDATE_FIELDS.join(","))).toBe(true);
  expect(output).toContain("alice;bob");
  expect(output).toContain("alice;https://github.com/alice");
});

test("output schema serializes csv rows through default and verbose field orders", () => {
  const sparseCandidate: SearchCandidate = {
    ...candidate,
    description: null,
    topics: [],
    language: null,
    updatedAt: null,
    pushedAt: null,
    matchedSignals: [],
    sourceUser: [],
    sourceInput: [],
  };

  expect(formatCsvCandidates([candidate])).toBe(
    [DEFAULT_OUTPUT_FIELDS.join(","), serializeOutputCsvRow(candidate)].join("\n"),
  );
  expect(formatCsvCandidates([candidate], { verbose: true })).toBe(
    [SEARCH_CANDIDATE_FIELDS.join(","), serializeOutputCsvRow(candidate, { verbose: true })].join("\n"),
  );
  expect(serializeOutputCsvRow(sparseCandidate)).toBe(
    [
      "https://github.com/alice/dotfiles",
      "alice/dotfiles",
      "",
      "42",
      "7",
      "",
      "false",
      "false",
      "",
      "",
      "9",
    ].join(","),
  );
});

test("format dispatcher routes json and csv with output options", () => {
  expect(formatOutput([candidate], "json")).toBe(formatJsonCandidates([candidate]));
  expect(formatOutput([candidate], "csv")).toBe(formatCsvCandidates([candidate]));
  expect(formatOutput([candidate], "json", { verbose: true })).toBe(formatJsonCandidates([candidate], { verbose: true }));
  expect(formatOutput([candidate], "csv", { verbose: true })).toBe(formatCsvCandidates([candidate], { verbose: true }));
});
