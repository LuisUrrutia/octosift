import { readdir } from "node:fs/promises";
import { join } from "node:path";

import type { SearchIntent } from "../domain/types";
import {
  createDefinitionScorer,
  DOTFILES_SEARCH_INTENT_DEFINITION,
  SKILLS_SEARCH_INTENT_DEFINITION,
  type ExactNameBoostDefinition,
  type NormalizationChoice,
  type ScoringField,
  type SearchIntentDefinition,
  type SearchIntentScorer,
  type WeightedTermGroupDefinition,
} from "./scoring";

export interface SearchIntentCatalog {
  intentNames: readonly SearchIntent[];
  resolve(intentName: SearchIntent): SearchIntentScorer | undefined;
}

export interface LoadSearchIntentCatalogOptions {
  configDir?: string;
}

interface ParsedCatalogFile {
  intent?: unknown;
}

interface ParsedIntentDefinition {
  name?: unknown;
  normalization?: unknown;
  exact_name?: unknown;
  term_group?: unknown;
  penalties?: unknown;
  clamp_min_score?: unknown;
}

const DEFAULT_CONFIG_DIR = "config";
const BUILT_IN_DEFINITIONS = [DOTFILES_SEARCH_INTENT_DEFINITION, SKILLS_SEARCH_INTENT_DEFINITION] as const;

export async function loadSearchIntentCatalog(options: LoadSearchIntentCatalogOptions = {}): Promise<SearchIntentCatalog> {
  const definitions = new Map<SearchIntent, SearchIntentDefinition>();
  for (const definition of BUILT_IN_DEFINITIONS) {
    definitions.set(definition.name, definition);
  }

  const configDir = options.configDir ?? DEFAULT_CONFIG_DIR;
  const explicitConfigDir = options.configDir !== undefined;
  const filenames = await readTomlFilenames(configDir, explicitConfigDir);

  for (const filename of filenames) {
    const path = join(configDir, filename);
    const parsed = await parseCatalogFile(path);
    for (const definition of parsed) {
      definitions.set(definition.name, definition);
    }
  }

  return createSearchIntentCatalog([...definitions.values()]);
}

export function createSearchIntentCatalog(definitions: readonly SearchIntentDefinition[]): SearchIntentCatalog {
  const scorers = new Map<SearchIntent, SearchIntentScorer>();
  for (const definition of definitions) {
    scorers.set(definition.name, createDefinitionScorer(definition));
  }

  return {
    intentNames: [...scorers.keys()],
    resolve: (intentName) => scorers.get(intentName),
  };
}

async function readTomlFilenames(configDir: string, explicitConfigDir: boolean): Promise<string[]> {
  try {
    const entries = await readdir(configDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".toml"))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (isNotFoundError(error) && !explicitConfigDir) {
      return [];
    }

    if (isNotFoundError(error)) {
      throw new Error(`Config directory not found: ${configDir}`);
    }

    throw error;
  }
}

async function parseCatalogFile(path: string): Promise<SearchIntentDefinition[]> {
  let parsed: ParsedCatalogFile;
  try {
    parsed = Bun.TOML.parse(await Bun.file(path).text()) as ParsedCatalogFile;
  } catch (error) {
    throw new Error(`Invalid TOML in ${path}: ${errorMessage(error)}`);
  }

  if (!Array.isArray(parsed.intent)) {
    throw new Error(`Invalid search intent definitions in ${path}: expected [[intent]] entries.`);
  }

  return parsed.intent.map((entry, index) => parseIntentDefinition(path, index, entry));
}

function parseIntentDefinition(path: string, index: number, entry: unknown): SearchIntentDefinition {
  if (!isRecord(entry)) {
    throw invalidDefinition(path, index, "definition must be a table");
  }

  const definition = entry as ParsedIntentDefinition;
  const name = requiredIntentName(definition.name, path, index);
  const normalization = parseNormalization(definition.normalization, path, index);
  const exactNameBoosts = parseExactNameBoosts(definition.exact_name, path, index);
  const termGroups = parseTermGroups(definition.term_group, path, index);
  const penalties = parsePenalties(definition.penalties, path, index);
  const clampMinScore = definition.clamp_min_score === undefined ? 0 : requiredNumber(definition.clamp_min_score, path, index, "clamp_min_score");

  if (exactNameBoosts.length === 0 && termGroups.length === 0) {
    throw invalidDefinition(path, index, "definition must include at least one exact_name or term_group");
  }

  return {
    name,
    normalization,
    exactNameBoosts,
    termGroups,
    forkPenalty: penalties.fork,
    archivedPenalty: penalties.archived,
    clampMinScore,
  };
}

function parseExactNameBoosts(value: unknown, path: string, intentIndex: number): ExactNameBoostDefinition[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw invalidDefinition(path, intentIndex, "exact_name must be an array of tables");
  }

  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw invalidDefinition(path, intentIndex, `exact_name ${index} must be a table`);
    }

    return {
      name: requiredString(entry.name, path, intentIndex, `exact_name ${index}.name`),
      score: requiredNumber(entry.score, path, intentIndex, `exact_name ${index}.score`),
      label: requiredString(entry.label, path, intentIndex, `exact_name ${index}.label`),
      key: optionalString(entry.key, path, intentIndex, `exact_name ${index}.key`),
      dedupeTerm: optionalString(entry.dedupe_term, path, intentIndex, `exact_name ${index}.dedupe_term`),
    };
  });
}

function parseTermGroups(value: unknown, path: string, intentIndex: number): WeightedTermGroupDefinition[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw invalidDefinition(path, intentIndex, "term_group must be an array of tables");
  }

  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw invalidDefinition(path, intentIndex, `term_group ${index} must be a table`);
    }

    return {
      label: requiredString(entry.label, path, intentIndex, `term_group ${index}.label`),
      score: requiredNumber(entry.score, path, intentIndex, `term_group ${index}.score`),
      terms: requiredStringArray(entry.terms, path, intentIndex, `term_group ${index}.terms`),
      fields: parseFields(entry.fields, path, intentIndex, index),
      dedupe: entry.dedupe === undefined ? true : requiredBoolean(entry.dedupe, path, intentIndex, `term_group ${index}.dedupe`),
    };
  });
}

function parseFields(value: unknown, path: string, intentIndex: number, groupIndex: number): ScoringField[] {
  const fields = requiredStringArray(value, path, intentIndex, `term_group ${groupIndex}.fields`);
  const scoringFields: ScoringField[] = [];
  for (const field of fields) {
    if (field !== "name" && field !== "description" && field !== "topics") {
      throw invalidDefinition(path, intentIndex, `term_group ${groupIndex}.fields contains unsupported field: ${field}`);
    }
    scoringFields.push(field);
  }

  return scoringFields;
}

function parsePenalties(value: unknown, path: string, intentIndex: number): { fork: number; archived: number } {
  if (value === undefined) {
    return { fork: -1, archived: -2 };
  }
  if (!isRecord(value)) {
    throw invalidDefinition(path, intentIndex, "penalties must be a table");
  }

  return {
    fork: value.fork === undefined ? -1 : requiredNumber(value.fork, path, intentIndex, "penalties.fork"),
    archived: value.archived === undefined ? -2 : requiredNumber(value.archived, path, intentIndex, "penalties.archived"),
  };
}

function parseNormalization(value: unknown, path: string, intentIndex: number): NormalizationChoice {
  const normalization = value === undefined ? "lowercase" : requiredString(value, path, intentIndex, "normalization");
  if (normalization !== "lowercase" && normalization !== "lowercase-separators") {
    throw invalidDefinition(path, intentIndex, `unsupported normalization: ${normalization}`);
  }

  return normalization;
}

function requiredString(value: unknown, path: string, intentIndex: number, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalidDefinition(path, intentIndex, `${field} must be a non-empty string`);
  }

  return value;
}

function requiredIntentName(value: unknown, path: string, intentIndex: number): string {
  const name = requiredString(value, path, intentIndex, "name");
  if (name !== name.trim() || /\s/.test(name) || name.startsWith("-")) {
    throw invalidDefinition(path, intentIndex, "name must be a command-safe token without whitespace or leading dashes");
  }

  return name;
}

function optionalString(value: unknown, path: string, intentIndex: number, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requiredString(value, path, intentIndex, field);
}

function requiredNumber(value: unknown, path: string, intentIndex: number, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw invalidDefinition(path, intentIndex, `${field} must be a finite number`);
  }

  return value;
}

function requiredBoolean(value: unknown, path: string, intentIndex: number, field: string): boolean {
  if (typeof value !== "boolean") {
    throw invalidDefinition(path, intentIndex, `${field} must be a boolean`);
  }

  return value;
}

function requiredStringArray(value: unknown, path: string, intentIndex: number, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    throw invalidDefinition(path, intentIndex, `${field} must be a non-empty string array`);
  }

  return [...value];
}

function invalidDefinition(path: string, index: number, reason: string): Error {
  return new Error(`Invalid search intent definition in ${path} at intent ${index}: ${reason}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNotFoundError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
