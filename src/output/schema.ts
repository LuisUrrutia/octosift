import { DOTFILES_CANDIDATE_FIELDS, type DotfilesCandidate, type MatchedSignal } from "../domain/types";

type OutputCandidateField = (typeof DOTFILES_CANDIDATE_FIELDS)[number];

export interface OutputMatchedSignal extends Record<keyof MatchedSignal, string | number> {
  key: string;
  label: string;
  score: number;
  evidence: string;
}

export interface OutputCandidate extends Record<OutputCandidateField, unknown> {}

function projectMatchedSignal(signal: MatchedSignal): OutputMatchedSignal {
  return {
    key: signal.key,
    label: signal.label,
    score: signal.score,
    evidence: signal.evidence,
  };
}

function projectOutputValue(field: OutputCandidateField, candidate: DotfilesCandidate): unknown {
  const value = candidate[field];

  if (field === "matchedSignals") {
    return candidate.matchedSignals.map(projectMatchedSignal);
  }

  if (Array.isArray(value)) {
    return [...value];
  }

  return value;
}

export function projectOutputCandidate(candidate: DotfilesCandidate): OutputCandidate {
  const outputCandidate = {} as OutputCandidate;

  for (const field of DOTFILES_CANDIDATE_FIELDS) {
    outputCandidate[field] = projectOutputValue(field, candidate);
  }

  return outputCandidate;
}

export function projectOutputCandidates(candidates: readonly DotfilesCandidate[]): OutputCandidate[] {
  return candidates.map(projectOutputCandidate);
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

function serializeCsvValue(field: OutputCandidateField, value: DotfilesCandidate[OutputCandidateField]): string {
  if (value === null) {
    return "";
  }

  if (field === "matchedSignals") {
    return serializeMatchedSignals(value as readonly MatchedSignal[]);
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

export function serializeOutputCsvRow(candidate: DotfilesCandidate): string {
  return DOTFILES_CANDIDATE_FIELDS.map((field) => escapeCsvCell(serializeCsvValue(field, candidate[field]))).join(",");
}

export function serializeOutputCsvHeader(): string {
  return DOTFILES_CANDIDATE_FIELDS.join(",");
}
