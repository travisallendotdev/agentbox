import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HookConfig } from "../../config/schema.ts";

export interface StageInputs {
  skillSources: Record<string, string>;
  hooks: HookConfig | undefined;
  env: Record<string, string> | undefined;
}

export interface Staging {
  dir: string;
}

function shSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export async function stageInjection(inputs: StageInputs): Promise<Staging> {
  const dir = mkdtempSync(join(tmpdir(), "agbx-stage-"));
  // skills
  const skillsRoot = join(dir, "home/agent/.claude/skills");
  mkdirSync(skillsRoot, { recursive: true });
  for (const [name, src] of Object.entries(inputs.skillSources)) {
    cpSync(src, join(skillsRoot, name), { recursive: true });
  }
  // settings.json
  const claudeDir = join(dir, "home/agent/.claude");
  mkdirSync(claudeDir, { recursive: true });
  const settings = inputs.hooks ? { hooks: inputs.hooks } : {};
  writeFileSync(join(claudeDir, "settings.json"), JSON.stringify(settings, null, 2) + "\n");
  // /etc/sandbox-persistent.sh
  const etcDir = join(dir, "etc");
  mkdirSync(etcDir, { recursive: true });
  const envLines = Object.entries(inputs.env ?? {})
    .map(([k, v]) => `export ${k}=${shSingleQuote(v)}`)
    .join("\n") + "\n";
  writeFileSync(join(etcDir, "sandbox-persistent.sh"), envLines);
  return { dir };
}
