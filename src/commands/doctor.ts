import { runSbx } from "../sbx/client.ts";
import { listEntries } from "../registry/registry.ts";
import { AgentboxError, formatError } from "../errors.ts";
import { homePaths } from "../paths.ts";
import { hasHostClaudeCredentials } from "../auth/host-credentials.ts";

export async function doctor(_args: string[]): Promise<number> {
  let problems = 0;
  // sbx on PATH
  try {
    const r = await runSbx(["version"]);
    if (r.exitCode !== 0) {
      process.stderr.write(formatError(new AgentboxError("sbx CLI is not working", {
        fix: "Install Docker Sandboxes: brew install docker/tap/sbx",
      })) + "\n");
      problems++;
    } else {
      const versionLine = r.stdout.split("\n").map(s => s.trim()).filter(Boolean)[0] ?? "(unknown)";
      process.stdout.write(`✓ sbx: ${versionLine}\n`);
    }
  } catch (e) {
    process.stderr.write(formatError(new AgentboxError("sbx CLI not found on PATH", {
      fix: "Install Docker Sandboxes: brew install docker/tap/sbx",
      cause: e,
    })) + "\n");
    return 1;
  }

  // === Auth checks ===
  let hasApiKey = false;
  let apiKeyError: unknown = undefined;
  try {
    const r = await runSbx(["secret", "ls", "-g"]);
    if (r.exitCode === 0) {
      const secrets = r.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
      hasApiKey = secrets.includes("anthropic");
    } else {
      apiKeyError = new Error(`sbx secret ls failed: ${r.stderr.trim()}`);
    }
  } catch (e) {
    apiKeyError = e;
  }

  const hasSession = await hasHostClaudeCredentials();

  // Reporting:
  if (hasApiKey) {
    process.stdout.write("✓ anthropic API key configured (sbx secret)\n");
  } else if (apiKeyError) {
    // Couldn't even check — surface that
    process.stderr.write(formatError(apiKeyError) + "\n");
  }

  if (hasSession) {
    process.stdout.write("✓ Claude session credentials available\n");
  }

  // Either/or evaluation: only a problem if BOTH are missing.
  if (!hasApiKey && !hasSession) {
    process.stderr.write(formatError(new AgentboxError(
      "no Anthropic auth available — neither API key (sbx secret) nor session credentials found",
      { fix: "Either run `sbx secret set -g anthropic` for API-key auth, or run `claude` to log in for session auth" },
    )) + "\n");
    problems++;
  }

  // Registry summary + drift detection
  let entries: Awaited<ReturnType<typeof listEntries>> = [];
  try {
    entries = await listEntries();
    process.stdout.write(`✓ registry: ${entries.length} sandbox(es) tracked\n`);
  } catch (e) {
    process.stderr.write(formatError(new AgentboxError("registry file is unreadable or corrupt", {
      fix: `Inspect ${homePaths().registry} for invalid JSON`,
      cause: e,
    })) + "\n");
    problems++;
  }

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
