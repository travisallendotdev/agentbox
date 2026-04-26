import { existsSync, rmSync } from "node:fs";
import { getEntry, removeEntry } from "../registry/registry.ts";
import { runSbx } from "../sbx/client.ts";
import { runLifecyclePhase } from "../lifecycle/hooks.ts";
import { parseConfigFile } from "../config/parse.ts";
import { resolveRepos } from "../config/resolve-repos.ts";
import { assertWorktreesClean, removeHostWorktrees } from "./up/worktrees.ts";
import { homePaths } from "../paths.ts";
import { createLogger } from "../log/logger.ts";
import { AgentboxError, formatError } from "../errors.ts";
import type { ResolvedRepo } from "../config/resolve-repos.ts";

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
    // Check for orphan state (sandbox dir or sbx VM) even though registry has no entry.
    const sandboxDir = homePaths().sandboxDir(flags.name);
    const hasDir = existsSync(sandboxDir);
    let hasSbx = false;
    try {
      const r = await runSbx(["ls", "--json"]);
      if (r.exitCode === 0 && r.stdout.trim()) {
        const live = JSON.parse(r.stdout) as { name: string }[];
        hasSbx = live.some(s => s.name === flags.name);
      }
    } catch { /* ignore */ }

    if (!hasDir && !hasSbx) {
      process.stderr.write(formatError(new AgentboxError(`No sandbox '${flags.name}' in registry, on disk, or in sbx`, {
        fix: "Run `agentbox ls` to see registered sandboxes",
      })) + "\n");
      return 1;
    }

    // Bare cleanup path: best-effort sbx rm + rm sandbox dir.
    // Cannot prune source-repo worktrees (config_path is gone).
    const log = await createLogger(flags.name);
    try {
      if (hasSbx) {
        try {
          const r = await runSbx(["rm", flags.name]);
          if (r.exitCode !== 0) log.warn(`sbx rm: ${r.stderr.trim()}`);
        } catch (e) { log.warn(`sbx rm: ${formatError(e)}`); }
      }
      if (hasDir) rmSync(sandboxDir, { recursive: true, force: true });
      process.stdout.write(`Cleaned orphan state for '${flags.name}' (no registry entry; source-repo worktrees not pruned — run \`git worktree prune\` in each source repo if needed)\n`);
      return 0;
    } finally {
      await log.close();
    }
  }
  const log = await createLogger(flags.name);
  try {
    // --- Phase 1: parse config and resolve repos (narrow try/catch for config errors only) ---
    let repos: ResolvedRepo[] | null = null;
    let cfg: Awaited<ReturnType<typeof parseConfigFile>> | null = null;
    try {
      cfg = await parseConfigFile(entry.config_path);
      repos = await resolveRepos(cfg.repos ?? [], flags.name);
    } catch (cfgErr) {
      // Config couldn't be parsed (file deleted, schema change, etc.) — proceed with bare cleanup
      log.warn(`config unreadable; performing bare cleanup: ${formatError(cfgErr)}`);
    }

    // --- Phase 2: pre-flight dirty-worktree check (before any destructive operation) ---
    // Only run when we have repos and force is not set.
    if (!flags.force && repos !== null && repos.length > 0) {
      await assertWorktreesClean(flags.name, repos);
      // assertWorktreesClean throws AgentboxError on dirty worktrees.
      // That throw propagates to the outer catch → returns 1, NO state changes made yet.
    }

    // --- Phase 3: destructive teardown (we are now committed to full removal) ---

    // on_stop lifecycle hook
    if (cfg !== null) {
      try {
        await runLifecyclePhase("on_stop", flags.name, cfg.lifecycle?.on_stop, log);
      } catch (e) { log.warn(`on_stop: ${formatError(e)}`); }
    }

    // Destroy the VM
    try {
      const r = await runSbx(["rm", flags.name]);
      if (r.exitCode !== 0) log.warn(`sbx rm: ${r.stderr.trim()}`);
    } catch (e) { log.warn(`sbx rm: ${formatError(e)}`); }

    // Remove host worktrees (always force at this point — we already pre-flighted)
    if (repos !== null) {
      try {
        await removeHostWorktrees(flags.name, repos, { force: true });
      } catch (e) {
        log.warn(`worktree cleanup: ${formatError(e)}`);
      }

      // Prune branches if requested
      if (flags.pruneBranches) {
        for (const r of repos) {
          if (r.source !== "local") continue;
          const proc = Bun.spawn({
            cmd: ["git", "-C", r.path, "branch", "-D", r.branch],
            stdout: "pipe",
            stderr: "pipe",
          });
          const code = await proc.exited;
          const stderr = await new Response(proc.stderr).text();
          if (code !== 0) log.warn(`branch -D ${r.branch} on ${r.path}: ${stderr.trim()}`);
        }
      }
    }

    // Remove sandbox dir and registry entry
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
