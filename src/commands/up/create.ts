import { runSbx } from "../../sbx/client.ts";
import { homePaths } from "../../paths.ts";
import { AgentboxError } from "../../errors.ts";
import type { UpPlan } from "./plan.ts";

export async function applyNetworkPolicy(plan: UpPlan): Promise<void> {
  const allow = plan.config.network?.allow ?? [];
  for (const entry of allow) {
    const r = await runSbx(["policy", "allow", "network", entry]);
    if (r.exitCode !== 0) {
      throw new AgentboxError(`sbx policy allow network ${entry} failed: ${r.stderr.trim()}`, {
        fix: "Verify the network entry syntax (e.g., 'github.com:443') and that sbx is healthy",
      });
    }
  }
}

/**
 * Expand a bare template variant (e.g. "claude-code-docker") to the full OCI
 * reference `docker.io/docker/sandbox-templates:<variant>`. sbx does not
 * auto-resolve docker.io for `--template`, and bare names get misread as
 * `library/<name>` — which 404s in the Docker Hub root namespace.
 *
 * Values that already look like an OCI reference (contain "/" or ":") are
 * passed through unchanged so custom templates still work.
 */
export function resolveTemplateRef(value: string): string {
  if (value.includes("/") || value.includes(":")) return value;
  return `docker.io/docker/sandbox-templates:${value}`;
}

export async function createSandbox(plan: UpPlan, opts: { injectMount?: string } = {}): Promise<string> {
  const parent = homePaths().repoParentDir(plan.name);
  const template = resolveTemplateRef(plan.baseTemplate);
  const args = ["create", "--name", plan.name, "--template", template, "claude", parent];
  // Mount the staging tree as a read-only "additional workspace". sbx's
  // virtiofs maps host paths to identical in-VM paths, so the inject step
  // can reference `injectMount` directly inside the VM.
  if (opts.injectMount) args.push(`${opts.injectMount}:ro`);
  // For each local-source repo, mount its `.git`. The host worktree (created
  // with --relative-paths) carries a relative gitdir pointer that resolves to
  // this mount via virtiofs. sbx mounts additional workspaces rw by default
  // (only `:ro` is a recognized suffix); rw is what we want here so the agent
  // can commit into the source's object store — that's the worktree contract.
  for (const repo of plan.repos) {
    if (repo.source !== "local") continue;
    args.push(`${repo.path}/.git`);
  }
  const r = await runSbx(args);
  if (r.exitCode !== 0) {
    throw new AgentboxError(`sbx create failed: ${r.stderr.trim()}`, {
      fix: "Run `agentbox doctor` to verify sbx and credentials",
    });
  }
  // sbx outputs the sandbox id; capture last non-empty line as the id, fallback to plan.name.
  const id = r.stdout.split("\n").map((s) => s.trim()).filter(Boolean).pop() ?? plan.name;
  return id;
}
