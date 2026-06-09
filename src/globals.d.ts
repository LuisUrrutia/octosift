interface BunSubprocess {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
}

declare const Bun: {
  argv: string[];
  file(path: string): { text(): Promise<string> };
  write(path: string, value: string): Promise<number>;
  TOML: { parse(value: string): unknown };
  spawn(command: readonly string[], options: { env: Record<string, string>; stdout: "pipe"; stderr: "pipe" }): BunSubprocess;
};

declare const process: {
  env: Record<string, string | undefined>;
  cwd(): string;
  chdir(path: string): void;
};

declare module "bun:test" {
  export function expect<T>(value: T): {
    toBe(expected: T): void;
    toContain(expected: string): void;
    toEqual(expected: unknown): void;
    toMatch(expected: RegExp): void;
    toMatchObject(expected: unknown): void;
    toBeGreaterThan(expected: number): void;
    not: { toBe(expected: T): void };
  };

  export function test(name: string, fn: () => void | Promise<void>): void;
}


declare module "node:fs/promises" {
  export interface Dirent {
    name: string;
    isFile(): boolean;
  }
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<unknown>;
  export function mkdtemp(prefix: string): Promise<string>;
  export function readdir(path: string, options: { withFileTypes: true }): Promise<Dirent[]>;
  export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
}

declare module "node:fs" {
  export function mkdtempSync(prefix: string): string;
}

declare module "node:path" {
  export function dirname(path: string): string;
  export function join(...paths: string[]): string;
}

declare module "node:os" {
  export function tmpdir(): string;
}
