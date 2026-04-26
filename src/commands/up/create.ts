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

export async function createSandbox(plan: UpPlan): Promise<string> {
  const parent = homePaths().repoParentDir(plan.name);
  const args = ["create", "--name", plan.name, "--template", plan.baseTemplate, "claude", parent];
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
