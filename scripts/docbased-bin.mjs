#!/usr/bin/env node
// Wrapper that lets `docbased ...` be invoked from any directory after
// `npm link`. The CLI itself (scripts/cli.ts) expects to run with cwd =
// project root so dotenv can find .env.local and tsx can resolve the @/*
// path aliases. We preserve the user's original cwd in DOCBASED_INVOCATION_CWD
// so path arguments (e.g. `docbased import ./notes`) still resolve against
// where the user actually ran the command.
//
// We deliberately skip the `npx`/`tsx` .cmd shims and invoke tsx's mjs entry
// directly: shell-mode spawns on Windows mis-split paths containing spaces
// (e.g. "OneDrive - Acme Corp"), and Node's post-CVE-2024-27980 restriction
// requires shell mode to spawn .cmd at all.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");
const cli = path.join(projectRoot, "scripts", "cli.ts");
const tsxEntry = path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");

const child = spawn(process.execPath, [tsxEntry, cli, ...process.argv.slice(2)], {
  cwd: projectRoot,
  stdio: "inherit",
  env: { ...process.env, DOCBASED_INVOCATION_CWD: process.cwd() },
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
