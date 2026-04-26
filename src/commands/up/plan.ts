import { basename } from "node:path";
import { parseConfigFile } from "../../config/parse.ts";
import { resolveRepos, type ResolvedRepo } from "../../config/resolve-repos.ts";
import { resolveAllSkills } from "../../config/resolve-skills.ts";
import { resolvePrompt } from "../../config/resolve-prompt.ts";
import { runSbx } from "../../sbx/client.ts";
import { AgentboxError } from "../../errors.ts";
import { readHostClaudeCredentials } from "../../auth/host-credentials.ts";
import type { AgentboxConfig } from "../../config/schema.ts";
import type { UpFlags } from "./flags.ts";

export interface UpPlan {
  name: string;
  mode: "durable" | "ephemeral";
  baseTemplate: string;
  configPath: string;
  configHash: string;
  config: AgentboxConfig;
  repos: ResolvedRepo[];
  /** Maps the raw skill ref (as written in config — e.g., "coding-standards", "superpowers:debug", or "/abs/path") to its resolved absolute path on the host. */
  skillSources: Record<string, string>;
  prompt?: string;
  keep: boolean;
  keepOnError: boolean;
  replace: boolean;
  verbose: boolean;
  authMode: "api_key" | "session";
  claudeCredentials?: string;  // populated when authMode === "session"
}

function deriveName(flags: UpFlags, cfg: AgentboxConfig): string {
  if (flags.name) return flags.name;
  if (cfg.name) return cfg.name;
  const f = basename(flags.configPath);
  return f.replace(/\.ya?ml$/i, "");
}

function ephemeralSuffix(): string {
  return Math.random().toString(36).slice(2, 6) + Date.now().toString(36).slice(-3);
}

async function configHash(path: string): Promise<string> {
  const text = await Bun.file(path).text();
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(text);
  return hasher.digest("hex");
}

export async function buildUpPlan(flags: UpFlags): Promise<UpPlan> {
  const cfg = await parseConfigFile(flags.configPath);
  let name = deriveName(flags, cfg);
  if (cfg.mode === "ephemeral") name = `${name}-${ephemeralSuffix()}`;

  const authMode: "api_key" | "session" = cfg.auth ?? "api_key";

  // Validate secrets — skip "anthropic" when using session auth
  if (cfg.secrets && cfg.secrets.length > 0) {
    const requiredSecrets = cfg.secrets.filter((s) => !(s === "anthropic" && authMode === "session"));
    if (requiredSecrets.length > 0) {
      const r = await runSbx(["secret", "ls", "-g"]);
      if (r.exitCode !== 0) {
        throw new AgentboxError(`sbx secret ls failed: ${r.stderr.trim()}`, {
          fix: "Verify sbx is installed and working: agentbox doctor",
        });
      }
      const present = new Set(r.stdout.split("\n").map((s) => s.trim()).filter(Boolean));
      for (const s of requiredSecrets) {
        if (!present.has(s)) {
          throw new AgentboxError(`secret not configured: ${s}`, {
            fix: `sbx secret set -g ${s}`,
            context: { required_by: `secrets[${cfg.secrets.indexOf(s)}]` },
          });
        }
      }
    }
  }

  // Load session credentials when auth mode requires it
  let claudeCredentials: string | undefined;
  if (authMode === "session") {
    claudeCredentials = await readHostClaudeCredentials();
  }

  const repos = await resolveRepos(cfg.repos ?? [], name);
  const skillSources = await resolveAllSkills(cfg.skills ?? []);
  const prompt = await resolvePrompt(cfg.prompt);

  return {
    name,
    mode: cfg.mode,
    baseTemplate: cfg.base_template ?? "claude-code-docker",
    configPath: flags.configPath,
    configHash: await configHash(flags.configPath),
    config: cfg,
    repos,
    skillSources,
    prompt,
    keep: flags.keep,
    keepOnError: flags.keepOnError,
    replace: flags.replace,
    verbose: flags.verbose,
    authMode,
    claudeCredentials,
  };
}
