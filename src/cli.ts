#!/usr/bin/env bun
import { up } from "./commands/up.ts";
import { start as run } from "./commands/start.ts";
import { stop } from "./commands/stop.ts";
import { shell } from "./commands/shell.ts";
import { rm } from "./commands/rm.ts";
import { ls } from "./commands/ls.ts";
import { doctor } from "./commands/doctor.ts";
import { init } from "./commands/init.ts";
import { formatError } from "./errors.ts";

const USAGE = `agentbox — declarative Claude Code sandboxes on Docker sbx

Usage:
  agentbox up <path>.yaml [--name <name>] [--replace] [--keep] [--keep-on-error] [-v|--verbose]
  agentbox run <name>
  agentbox stop <name>
  agentbox shell <name>
  agentbox rm <name> [--force] [--prune-branches]
  agentbox init [<path>] [--force]
  agentbox ls
  agentbox doctor

Run agentbox <command> --help for command-specific help.
`;

const HANDLERS: Record<string, (args: string[]) => Promise<number>> = {
  up, run, start: run, stop, shell, rm, ls, doctor, init,
};

export async function runCli(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(USAGE);
    return 0;
  }
  const [cmd, ...rest] = argv as [string, ...string[]];
  const handler = HANDLERS[cmd];
  if (!handler) {
    process.stderr.write(`Unknown command: ${cmd}\n\n${USAGE}`);
    return 2;
  }
  try {
    return await handler(rest);
  } catch (err) {
    process.stderr.write(formatError(err) + "\n");
    return 1;
  }
}

if (import.meta.main) {
  const code = await runCli(process.argv.slice(2));
  process.exit(code);
}
