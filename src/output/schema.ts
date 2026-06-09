import { DEFAULT_SEARCH_CANDIDATE_FIELDS, SEARCH_CANDIDATE_FIELDS, type SearchCandidate, type MatchedSignal } from "../domain/types";

type OutputCandidateField = (typeof SEARCH_CANDIDATE_FIELDS)[number];

export interface OutputOptions {
  verbose?: boolean;
}

export interface OutputMatchedSignal extends Record<keyof MatchedSignal, string | number> {
  key: string;
  label: string;
  score: number;
  evidence: string;
}

export type OutputCandidate = Partial<Record<OutputCandidateField, unknown>>;

function selectOutputFields(options: OutputOptions = {}): readonly OutputCandidateField[] {
  return options.verbose === true ? SEARCH_CANDIDATE_FIELDS : DEFAULT_SEARCH_CANDIDATE_FIELDS;
}

function projectMatchedSignal(signal: MatchedSignal): OutputMatchedSignal {
  return {
    key: signal.key,
    label: signal.label,
    score: signal.score,
    evidence: signal.evidence,
  };
}

function projectOutputValue(field: OutputCandidateField, candidate: SearchCandidate): unknown {
  const value = candidate[field];

  if (field === "matchedSignals") {
    return candidate.matchedSignals.map(projectMatchedSignal);
  }

  if (Array.isArray(value)) {
    return [...value];
  }

  return value;
}

export function projectOutputCandidate(candidate: SearchCandidate, options: OutputOptions = {}): OutputCandidate {
  const outputCandidate: OutputCandidate = {};

  for (const field of selectOutputFields(options)) {
    outputCandidate[field] = projectOutputValue(field, candidate);
  }

  return outputCandidate;
}

export function projectOutputCandidates(candidates: readonly SearchCandidate[], options: OutputOptions = {}): OutputCandidate[] {
  return candidates.map((candidate) => projectOutputCandidate(candidate, options));
}

function serializeStringArray(values: readonly string[]): string {
  return values.join(";");
}

function serializeMatchedSignal(signal: MatchedSignal): string {
  return [signal.key, signal.label, String(signal.score), signal.evidence].join("|");
}

function serializeMatchedSignals(signals: readonly MatchedSignal[]): string {
  return signals.map(serializeMatchedSignal).join(";");
}

function serializeCsvValue(field: OutputCandidateField, candidate: SearchCandidate): string {
  if (field === "matchedSignals") {
    return serializeMatchedSignals(candidate.matchedSignals);
  }

  const value = candidate[field];

  if (value === null) {
    return "";
  }

  if (Array.isArray(value)) {
    return serializeStringArray(value);
  }

  return String(value);
}

function escapeCsvCell(value: string): string {
  if (!/[",\n\r]/.test(value)) {
    return value;
  }

  return `"${value.replaceAll('"', '""')}"`;
}

export function serializeOutputCsvRow(candidate: SearchCandidate, options: OutputOptions = {}): string {
  return selectOutputFields(options).map((field) => escapeCsvCell(serializeCsvValue(field, candidate))).join(",");
}

export function serializeOutputCsvHeader(options: OutputOptions = {}): string {
  return selectOutputFields(options).join(",");
}
