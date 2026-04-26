import { existsSync, rmSync } from "node:fs";
import { getEntry, removeEntry } from "../registry/registry.ts";
import { runSbx } from "../sbx/client.ts";
import { runLifecyclePhase } from "../lifecycle/hooks.ts";
import { parseConfigFile } from "../config/parse.ts";
import { resolveRepos } from "../config/resolve-repos.ts";
import { removeHostWorktrees } from "./up/worktrees.ts";
import { homePaths } from "../paths.ts";
import { createLogger } from "../log/logger.ts";
import { AgentboxError, formatError } from "../errors.ts";

interface RmFlags { name: string; force: boolean; pruneBranches: boolean }

function parseRmFlags(args: string[]): RmFlags {
  let name: string | undefined;
  let force = false;
  let pruneBranches = false;
  for (const a of args) {
    if (a === "--force") force = true;
    else if (a === "--prune-branches") pruneBranches = true;
    else if (a.startsWith("--")) throw new AgentboxError(`unknown flag: ${a}`, { fix: "Run `agentbox --help`" });
    else if (name) throw new AgentboxError(`unexpected argument: ${a}`, { fix: "Only one positional name argument is accepted" });
    else name = a;
  }
  if (!name) throw new AgentboxError("usage: agentbox rm <name> [--force] [--prune-branches]");
  return { name, force, pruneBranches };
}

export async function rm(args: string[]): Promise<number> {
  let flags: RmFlags;
  try { flags = parseRmFlags(args); }
  catch (err) { process.stderr.write(formatError(err) + "\n"); return 1; }

  const entry = await getEntry(flags.name);
  if (!entry) {
    process.stderr.write(formatError(new AgentboxError(`No sandbox '${flags.name}' in registry`, {
      fix: "Run `agentbox ls` to see registered sandboxes",
    })) + "\n");
    return 1;
  }
  const log = await createLogger(flags.name);
  try {
    // Best-effort on_stop + cleanup. Each step is independently guarded so a failure
    // in one doesn't block the rest of teardown.
    try {
      const cfg = await parseConfigFile(entry.config_path);
      try {
        await runLifecyclePhase("on_stop", flags.name, cfg.lifecycle?.on_stop, log);
      } catch (e) { log.warn(`on_stop: ${formatError(e)}`); }

      const repos = await resolveRepos(cfg.repos ?? [], flags.name);

      try {
        const r = await runSbx(["rm", flags.name]);
        if (r.exitCode !== 0) log.warn(`sbx rm: ${r.stderr.trim()}`);
      } catch (e) { log.warn(`sbx rm: ${formatError(e)}`); }

      try {
        await removeHostWorktrees(flags.name, repos, { force: flags.force });
      } catch (e) {
        // Surface this — dirty worktree without --force is a real problem
        if (!flags.force) throw e;
        log.warn(`worktree cleanup: ${formatError(e)}`);
      }

      if (flags.pruneBranches) {
        for (const r of repos) {
          if (r.source !== "local") continue;
          const proc = Bun.spawn({
            cmd: ["git", "-C", r.path, "branch", "-D", r.branch],
            stdout: "pipe",
            stderr: "pipe",
          });
          await proc.exited;
        }
      }
    } catch (cfgErr) {
      // Config couldn't be parsed (file deleted, etc.) — fall back to bare cleanup
      log.warn(`config unreadable; performing bare cleanup: ${formatError(cfgErr)}`);
      try {
        const r = await runSbx(["rm", flags.name]);
        if (r.exitCode !== 0) log.warn(`sbx rm: ${r.stderr.trim()}`);
      } catch (e) { log.warn(`sbx rm: ${formatError(e)}`); }
    }
    const sb = homePaths().sandboxDir(flags.name);
    if (existsSync(sb)) rmSync(sb, { recursive: true, force: true });
    await removeEntry(flags.name);
    return 0;
  } catch (err) {
    log.error(formatError(err));
    process.stderr.write(formatError(err) + "\n");
    return 1;
  } finally {
    await log.close();
  }
}
