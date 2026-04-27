import { mkdirSync, existsSync, rmSync } from "node:fs";
import { homePaths } from "../../paths.ts";
import { addEntry, getEntry, removeEntry } from "../../registry/registry.ts";
import { runSbx, runSbxInherit } from "../../sbx/client.ts";
import { injectFiles } from "../../sbx/inject.ts";
import { createLogger, type Logger } from "../../log/logger.ts";
import { AgentboxError, formatError } from "../../errors.ts";
import { buildUpPlan, type UpPlan } from "./plan.ts";
import { applyNetworkPolicy, createSandbox } from "./create.ts";
import { stageInjection } from "./stage.ts";
import { createHostWorktrees, removeHostWorktrees } from "./worktrees.ts";
import { pruneWorktrees } from "../../git/worktree.ts";
import { cloneGitRepos } from "./clone.ts";
import { runLifecyclePhase } from "../../lifecycle/hooks.ts";
import type { UpFlags } from "./flags.ts";

async function rollback(plan: UpPlan, log: Logger, opts: { pastCreate: boolean; pastWorktrees: boolean; pastRegistry: boolean }): Promise<void> {
  log.warn("rolling back partial sandbox");
  if (opts.pastCreate) {
    try { await runSbx(["rm", plan.name]); } catch (e) { log.warn(`sbx rm: ${(e as Error).message}`); }
  }
  if (opts.pastWorktrees) {
    try { await removeHostWorktrees(plan.name, plan.repos, { force: true }); }
    catch (e) { log.warn(`worktree cleanup: ${(e as Error).message}`); }
  }
  const sb = homePaths().sandboxDir(plan.name);
  if (existsSync(sb)) rmSync(sb, { recursive: true, force: true });
  if (opts.pastRegistry) {
    try { await removeEntry(plan.name); } catch (e) { log.warn(`registry cleanup: ${(e as Error).message}`); }
  }
}

function cleanupStaging(stageDir: string | undefined): void {
  if (stageDir && existsSync(stageDir)) {
    try { rmSync(stageDir, { recursive: true, force: true }); } catch {}
  }
}

export async function runUp(flags: UpFlags): Promise<number> {
  let plan: UpPlan;
  try {
    plan = await buildUpPlan(flags);
  } catch (err) {
    process.stderr.write(formatError(err) + "\n");
    return 1;
  }

  // Pre-flight: registry collision check before any disk changes.
  const existingEntry = await getEntry(plan.name);
  if (existingEntry && !plan.replace) {
    process.stderr.write(formatError(new AgentboxError(
      `Sandbox '${plan.name}' already exists in the registry`,
      { fix: "Run `agentbox rm " + plan.name + "` first, or pass --replace to overwrite" },
    )) + "\n");
    return 1;
  }

  // Pre-flight: leftover sandbox dir check (covers failed prior run where registry was never written).
  const sandboxDirPath = homePaths().sandboxDir(plan.name);
  if (existsSync(sandboxDirPath) && !plan.replace) {
    if (!existingEntry) {
      process.stderr.write(formatError(new AgentboxError(
        `Leftover sandbox state at ${sandboxDirPath} (likely from a failed prior run)`,
        { fix: "Run `agentbox rm " + plan.name + " --force` to clean up, or pass --replace to overwrite" },
      )) + "\n");
      return 1;
    }
  }

  const log = await createLogger(plan.name, { verbose: plan.verbose });
  let pastWorktrees = false;
  let pastCreate = false;
  let pastRegistry = false;
  let stageDir: string | undefined;

  // If --replace is in effect, tear down anything that might survive from a
  // prior run. sbx state, the local sandbox dir, registry entries, and stale
  // worktree metadata can each exist independently (e.g. a hung run that
  // created the sbx VM but never wrote the registry entry). Each step is
  // best-effort and idempotent — we always attempt them all.
  if (plan.replace) {
    log.info(`replace: tearing down existing state for ${plan.name}`);
    try { await runSbx(["rm", plan.name]); } catch { /* sbx may not have it */ }
    if (existingEntry) {
      try { await removeEntry(plan.name); } catch { /* ignore */ }
    }
    if (existsSync(sandboxDirPath)) rmSync(sandboxDirPath, { recursive: true, force: true });
    for (const r of plan.repos) {
      if (r.source !== "local") continue;
      try { await pruneWorktrees(r.path); } catch { /* ignore */ }
    }
  }

  try {
    log.info(`up: name=${plan.name} mode=${plan.mode}`);
    mkdirSync(homePaths().repoParentDir(plan.name), { recursive: true });

    // Host worktrees (no sbx state yet)
    await log.phase("worktrees", async () => {
      await createHostWorktrees(plan.name, plan.repos);
      pastWorktrees = true;
    });
    // Network policy
    await log.phase("network", () => applyNetworkPolicy(plan));
    // sbx create — past this point, rollback runs sbx rm
    await log.phase("sbx create", async () => { await createSandbox(plan); pastCreate = true; });
    // Stage and inject
    const stage = await log.phase("stage", () => stageInjection({
      skillSources: plan.skillSources,
      plugins: plan.plugins,
      hooks: plan.config.hooks,
      env: plan.config.env,
      credentials: plan.claudeCredentials,
    }));
    stageDir = stage.dir;
    await log.phase("inject", () => injectFiles(plan.name, stage.dir, "/"));
    // Lifecycle: post_create
    await runLifecyclePhase("post_create", plan.name, plan.config.lifecycle?.post_create, log);
    // Clone git repos
    await log.phase("clone", () => cloneGitRepos(plan.name, plan.repos));
    // Lifecycle: pre_agent
    await runLifecyclePhase("pre_agent", plan.name, plan.config.lifecycle?.pre_agent, log);

    // Registry write
    await addEntry({
      name: plan.name,
      config_path: plan.configPath,
      mode: plan.mode,
      created_at: new Date().toISOString(),
      sbx_sandbox_id: plan.name,
      config_hash: plan.configHash,
    }, { replace: plan.replace });
    pastRegistry = true;

    log.info("up: bootstrap complete; launching agent");
    await log.close();
    cleanupStaging(stageDir);

    // Launch agent — this blocks until the agent exits.
    // `sbx run <name>` attaches to the existing named sandbox (created via `sbx create` above)
    // and blocks while the Claude agent runs. stdio is inherited so the user sees the agent TUI directly.
    // Per docker/docs `content/manuals/ai/sandboxes/usage.md`: "$ sbx run my-sandbox" attaches by name.
    const promptArgs = plan.prompt ? ["--", plan.prompt] : [];
    const agentExit = await runSbxInherit(["run", plan.name, ...promptArgs]);

    // on_stop
    const log2 = await createLogger(plan.name, { verbose: plan.verbose });
    try {
      await runLifecyclePhase("on_stop", plan.name, plan.config.lifecycle?.on_stop, log2);
    } finally {
      await log2.close();
    }

    // Ephemeral teardown
    if (plan.mode === "ephemeral" && !plan.keep) {
      await runSbx(["rm", plan.name]);
      await removeHostWorktrees(plan.name, plan.repos, { force: true });
      await removeEntry(plan.name);
    }
    return agentExit;
  } catch (err) {
    log.error(formatError(err));
    if ((pastCreate || pastWorktrees) && !plan.keepOnError) {
      await rollback(plan, log, { pastCreate, pastWorktrees, pastRegistry });
    }
    await log.close();
    cleanupStaging(stageDir);
    process.stderr.write(formatError(err) + "\n");
    return 1;
  }
}
