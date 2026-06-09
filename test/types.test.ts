import { expect, test } from "bun:test";

import {
  SEARCH_CANDIDATE_FIELDS,
  EXIT_CODE_INVALID_INPUT,
  EXIT_CODE_PARTIAL_FAILURE,
  EXIT_CODE_RATE_LIMIT_EXHAUSTED,
  EXIT_CODE_SUCCESS,
  type SearchCandidate,
} from "../src/domain/types";

type CandidateKeys = keyof SearchCandidate;
type ExpectedCandidateKeys = (typeof SEARCH_CANDIDATE_FIELDS)[number];
type AssertExactKeys = [CandidateKeys] extends [ExpectedCandidateKeys]
  ? ([ExpectedCandidateKeys] extends [CandidateKeys] ? true : never)
  : never;

const keyCheck: AssertExactKeys = true;

test("search candidate keys match the approved schema", () => {
  void keyCheck;

  const expectedKeys = [
    "url",
    "owner",
    "name",
    "fullName",
    "description",
    "topics",
    "stars",
    "forks",
    "language",
    "isFork",
    "isArchived",
    "updatedAt",
    "pushedAt",
    "matchedSignals",
    "score",
    "sourceUser",
    "sourceInput",
  ];

  expect(JSON.stringify(SEARCH_CANDIDATE_FIELDS)).toBe(JSON.stringify(expectedKeys));
});

test("exit code constants match the approved values", () => {
  expect(EXIT_CODE_SUCCESS).toBe(0);
  expect(EXIT_CODE_INVALID_INPUT).toBe(1);
  expect(EXIT_CODE_PARTIAL_FAILURE).toBe(2);
  expect(EXIT_CODE_RATE_LIMIT_EXHAUSTED).toBe(3);
});
