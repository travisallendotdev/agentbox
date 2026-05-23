import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { AgentboxError } from "../errors.ts";

function expandHome(p: string): string {
  if (p.startsWith("~/")) return join(process.env.HOME!, p.slice(2));
  if (!isAbsolute(p)) return join(process.cwd(), p);
  return p;
}

function keychainService(claudeConfigDir?: string): string {
  if (!claudeConfigDir) return "Claude Code-credentials";
  const abs = expandHome(claudeConfigDir);
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(abs);
  const hash = hasher.digest("hex").slice(0, 8);
  return `Claude Code-credentials-${hash}`;
}

/**
 * Extracts the host's Claude Code OAuth credentials JSON.
 * - macOS: reads from Keychain; service name is "Claude Code-credentials" for the
 *   default config dir, or "Claude Code-credentials-<sha256[:8]>" for a custom one.
 * - Linux: reads .credentials.json from the config dir (defaults to ~/.claude).
 *
 * Returns the credential JSON as a string, ready to be written to
 * /home/agent/.claude/.credentials.json inside the sandbox.
 *
 * Override the source via AGENTBOX_CLAUDE_CREDENTIALS_FILE for testing.
 */
export async function readHostClaudeCredentials(
  claudeConfigDir?: string,
): Promise<string> {
  // Test override
  const override = process.env.AGENTBOX_CLAUDE_CREDENTIALS_FILE;
  if (override) {
    if (!existsSync(override)) {
      throw new AgentboxError(
        `AGENTBOX_CLAUDE_CREDENTIALS_FILE points at a missing file: ${override}`,
        {
          fix: "Unset AGENTBOX_CLAUDE_CREDENTIALS_FILE or point it at an existing credentials JSON",
        },
      );
    }
    return readFileSync(override, "utf8");
  }

  if (process.platform === "darwin") {
    const user = process.env.USER;
    if (!user) {
      throw new AgentboxError(
        "Cannot read Claude credentials: USER env var is not set",
        {
          fix: "Run from an interactive shell or set USER explicitly",
        },
      );
    }
    const service = keychainService(claudeConfigDir);
    const proc = Bun.spawn({
      cmd: [
        "security",
        "find-generic-password",
        "-s",
        service,
        "-a",
        user,
        "-w",
      ],
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (code !== 0) {
      throw new AgentboxError(
        `No Claude session credentials in Keychain (service "${service}", account "${user}")`,
        {
          fix: "Run `claude` once to authenticate, then re-run agentbox up. Or set auth: api_key in your config.",
          context: { stderr: stderr.trim() || "<empty>" },
        },
      );
    }
    return stdout.trimEnd();
  }

  // Linux: credentials live as a file inside the config dir
  const configDir = claudeConfigDir
    ? expandHome(claudeConfigDir)
    : join(process.env.HOME ?? "", ".claude");
  const path = join(configDir, ".credentials.json");
  if (!existsSync(path)) {
    throw new AgentboxError(`Claude session credentials not found at ${path}`, {
      fix: "Run `claude` once to authenticate, then re-run agentbox up. Or set auth: api_key in your config.",
    });
  }
  return readFileSync(path, "utf8");
}

/** Cheap availability check (no exceptions). Used by `agentbox doctor`. */
export async function hasHostClaudeCredentials(): Promise<boolean> {
  try {
    await readHostClaudeCredentials();
    return true;
  } catch {
    return false;
  }
}
