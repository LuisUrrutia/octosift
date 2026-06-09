import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface CacheEnvelope<T> {
  fetchedAt: number;
  ttlSeconds: number;
  key: string;
  value: T;
}

export interface FileCacheOptions {
  baseDir?: string;
  now?: () => number;
}

export type CacheReadResult<T> =
  | { status: "hit"; value: T; envelope: CacheEnvelope<T> }
  | { status: "miss" }
  | { status: "stale"; envelope: CacheEnvelope<T> };

const DEFAULT_CACHE_DIR = "~/.local/share/octosift";

export class FileCache {
  readonly baseDir: string;

  private readonly now: () => number;

  constructor(options: FileCacheOptions = {}) {
    this.baseDir = options.baseDir ?? defaultCacheDir();
    this.now = options.now ?? Date.now;
  }

  async read<T>(key: string): Promise<CacheReadResult<T>> {
    const envelope = await this.readEnvelope<T>(key);

    if (envelope === undefined) {
      return { status: "miss" };
    }

    const ageMilliseconds = this.now() - envelope.fetchedAt;
    const ttlMilliseconds = envelope.ttlSeconds * 1000;

    if (ageMilliseconds >= 0 && ageMilliseconds < ttlMilliseconds) {
      return { status: "hit", value: envelope.value, envelope };
    }

    return { status: "stale", envelope };
  }

  async write<T>(key: string, value: T, ttlSeconds: number): Promise<CacheEnvelope<T>> {
    const envelope: CacheEnvelope<T> = {
      fetchedAt: this.now(),
      ttlSeconds,
      key,
      value,
    };

    const path = this.pathForKey(key);
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, JSON.stringify(envelope));
    return envelope;
  }

  async clear(): Promise<void> {
    await rm(this.baseDir, { recursive: true, force: true });
  }

  pathForKey(key: string): string {
    return join(this.baseDir, `${safeCacheKey(key)}.json`);
  }

  private async readEnvelope<T>(key: string): Promise<CacheEnvelope<T> | undefined> {
    const path = this.pathForKey(key);

    try {
      const text = await Bun.file(path).text();
      const parsed = JSON.parse(text) as CacheEnvelope<T>;

      if (!isEnvelope(parsed, key)) {
        return undefined;
      }

      return parsed;
    } catch (error) {
      if (isMissingFileError(error)) {
        return undefined;
      }

      return undefined;
    }
  }
}

export function defaultCacheDir(): string {
  const home = process.env.HOME;
  return home === undefined || home.length === 0 ? DEFAULT_CACHE_DIR : join(home, ".local", "share", "octosift");
}

export function safeCacheKey(key: string): string {
  return Array.from(new TextEncoder().encode(key), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isEnvelope<T>(value: CacheEnvelope<T>, key: string): value is CacheEnvelope<T> {
  return typeof value === "object"
    && value !== null
    && value.key === key
    && typeof value.fetchedAt === "number"
    && Number.isFinite(value.fetchedAt)
    && typeof value.ttlSeconds === "number"
    && Number.isFinite(value.ttlSeconds)
    && "value" in value;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "ENOENT";
}
