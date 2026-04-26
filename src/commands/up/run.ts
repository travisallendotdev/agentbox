import { mkdirSync, existsSync, rmSync } from "node:fs";
import { homePaths } from "../../paths.ts";
import { addEntry } from "../../registry/registry.ts";
import { runSbx, runSbxInherit } from "../../sbx/client.ts";
import { injectFiles } from "../../sbx/inject.ts";
import { createLogger, type Logger } from "../../log/logger.ts";
import { formatError } from "../../errors.ts";
import { buildUpPlan, type UpPlan } from "./plan.ts";
import { applyNetworkPolicy, createSandbox } from "./create.ts";
import { stageInjection } from "./stage.ts";
import { createHostWorktrees, removeHostWorktrees } from "./worktrees.ts";
import { cloneGitRepos } from "./clone.ts";
import { runLifecyclePhase } from "../../lifecycle/hooks.ts";
import type { UpFlags } from "./flags.ts";

async function rollback(plan: UpPlan, log: Logger): Promise<void> {
  log.warn("rolling back partial sandbox");
  try { await runSbx(["rm", plan.name]); } catch (e) { log.warn(`sbx rm: ${(e as Error).message}`); }
  try { await removeHostWorktrees(plan.name, plan.repos, { force: true }); } catch (e) { log.warn(`worktree cleanup: ${(e as Error).message}`); }
  const sb = homePaths().sandboxDir(plan.name);
  if (existsSync(sb)) rmSync(sb, { recursive: true, force: true });
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

  const log = await createLogger(plan.name, { verbose: plan.verbose });
  let pastCreate = false;
  let stageDir: string | undefined;

  try {
    log.info(`up: name=${plan.name} mode=${plan.mode}`);
    mkdirSync(homePaths().repoParentDir(plan.name), { recursive: true });

    // Host worktrees (no sbx state yet)
    await log.phase("worktrees", () => createHostWorktrees(plan.name, plan.repos));
    // Network policy
    await log.phase("network", () => applyNetworkPolicy(plan));
    // sbx create — past this point, rollback runs sbx rm
    await log.phase("sbx create", async () => { await createSandbox(plan); pastCreate = true; });
    // Stage and inject
    const stage = await log.phase("stage", () => stageInjection({
      skillSources: plan.skillSources,
      hooks: plan.config.hooks,
      env: plan.config.env,
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

    log.info("up: bootstrap complete; launching agent");
    await log.close();
    cleanupStaging(stageDir);

    // Launch agent — this blocks until the agent exits.
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
      const { removeEntry } = await import("../../registry/registry.ts");
      await removeEntry(plan.name);
    }
    return agentExit;
  } catch (err) {
    log.error(formatError(err));
    if (pastCreate && !plan.keepOnError) await rollback(plan, log);
    await log.close();
    cleanupStaging(stageDir);
    process.stderr.write(formatError(err) + "\n");
    return 1;
  }
}
