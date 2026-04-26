import { runSbx } from "../sbx/client.ts";
import { listEntries } from "../registry/registry.ts";
import { AgentboxError, formatError } from "../errors.ts";

export async function doctor(_args: string[]): Promise<number> {
  let problems = 0;
  // sbx on PATH
  try {
    const r = await runSbx(["--version"]);
    if (r.exitCode !== 0) {
      process.stderr.write(formatError(new AgentboxError("sbx CLI is not working", {
        fix: "Install Docker Sandboxes: brew install docker/tap/sbx",
      })) + "\n");
      problems++;
    } else {
      process.stdout.write(`✓ sbx: ${r.stdout.trim()}\n`);
    }
  } catch (e) {
    process.stderr.write(formatError(new AgentboxError("sbx CLI not found on PATH", {
      fix: "Install Docker Sandboxes: brew install docker/tap/sbx",
      cause: e,
    })) + "\n");
    return 1;
  }

  // Anthropic secret
  try {
    const r = await runSbx(["secret", "ls", "-g"]);
    const secrets = r.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
    if (secrets.includes("anthropic")) {
      process.stdout.write("✓ anthropic secret configured\n");
    } else {
      process.stderr.write(formatError(new AgentboxError("anthropic secret not configured", {
        fix: "sbx secret set -g anthropic",
      })) + "\n");
      problems++;
    }
  } catch (e) {
    process.stderr.write(formatError(e) + "\n");
    problems++;
  }

  // Registry summary + drift detection
  const entries = await listEntries();
  process.stdout.write(`✓ registry: ${entries.length} sandbox(es) tracked\n`);

  if (entries.length > 0) {
    const r = await runSbx(["ls", "--json"]);
    let live: { name: string }[] = [];
    if (r.exitCode === 0 && r.stdout.trim()) {
      try { live = JSON.parse(r.stdout); } catch {}
    }
    const liveNames = new Set(live.map((e) => e.name));
    const orphans = entries.filter((e) => !liveNames.has(e.name));
    if (orphans.length > 0) {
      process.stderr.write(formatError(new AgentboxError(
        `${orphans.length} orphaned registry entr${orphans.length === 1 ? "y" : "ies"}: ${orphans.map((o) => o.name).join(", ")}`,
        { fix: "Run `agentbox rm <name>` to clean up each orphan" },
      )) + "\n");
      problems++;
    } else {
      process.stdout.write("✓ no registry drift\n");
    }
  }

  return problems === 0 ? 0 : 1;
}
