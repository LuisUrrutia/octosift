#!/usr/bin/env bun

import { runCli } from "./cli/index";

const exitCode = await runCli(Bun.argv.slice(2));

if (exitCode !== 0) {
  (globalThis as typeof globalThis & { process: { exit(code?: number): never } }).process.exit(exitCode);
}
