import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSandboxGitconfig } from "../../config/host-gitconfig.ts";
import { readHostExtraMarketplaces } from "../../config/host-plugin-settings.ts";
import type { ResolvedPlugin } from "../../config/resolve-plugins.ts";
import type { HookConfig } from "../../config/schema.ts";

export interface StageInputs {
  skillSources: Record<string, string>;
  plugins: ResolvedPlugin[];
  hooks: HookConfig | undefined;
  env: Record<string, string> | undefined;
  credentials?: string;
  /**
   * Destination dir for the staged tree. When set, contents are written here
   * (after wiping the dir). When omitted, a fresh mkdtemp under tmpdir is used
   * (for tests). The dir's host path is also its in-VM path via sbx virtiofs,
   * so it must live somewhere stable for the VM's lifetime — `agentbox up`
   * uses `<sandboxDir>/inject/`.
   */
  outDir?: string;
}

export interface Staging {
  dir: string;
}

function shSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function copyPluginTree(src: string, dst: string): void {
  // Skip node_modules and .git — they bloat the inject and are never useful
  // inside the agent sandbox.
  cpSync(src, dst, {
    recursive: true,
    filter: (s) => {
      const n = s.split("/").pop() ?? "";
      return n !== "node_modules" && n !== ".git";
    },
  });
}

export async function stageInjection(inputs: StageInputs): Promise<Staging> {
  let dir: string;
  if (inputs.outDir) {
    dir = inputs.outDir;
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
  } else {
    dir = mkdtempSync(join(tmpdir(), "agbx-stage-"));
  }
  // skills
  const skillsRoot = join(dir, "home/agent/.claude/skills");
  mkdirSync(skillsRoot, { recursive: true });
  for (const [name, src] of Object.entries(inputs.skillSources)) {
    cpSync(src, join(skillsRoot, name), { recursive: true });
  }
  // plugins — copy each tree under plugins/cache/<marketplace>/<plugin>/<version>/
  const enabledPlugins: Record<string, boolean> = {};
  const extraKnownMarketplaces: Record<string, unknown> = {};
  if (inputs.plugins.length > 0) {
    const hostMarketplaces = readHostExtraMarketplaces();
    for (const p of inputs.plugins) {
      const dst = join(
        dir,
        "home/agent/.claude/plugins/cache",
        p.marketplace,
        p.name,
        p.version,
      );
      mkdirSync(dst, { recursive: true });
      copyPluginTree(p.path, dst);
      enabledPlugins[`${p.name}@${p.marketplace}`] = true;
      // Pull through the host's `extraKnownMarketplaces` entry if present so
      // the loader inside the VM recognizes non-official marketplaces. Built-in
      // marketplaces (e.g. claude-plugins-official) won't have entries here,
      // and don't need them.
      if (hostMarketplaces[p.marketplace]) {
        extraKnownMarketplaces[p.marketplace] = hostMarketplaces[p.marketplace];
      }
    }
  }
  // settings.json
  const claudeDir = join(dir, "home/agent/.claude");
  mkdirSync(claudeDir, { recursive: true });
  const settings: Record<string, unknown> = {};
  if (inputs.hooks) settings.hooks = inputs.hooks;
  if (Object.keys(enabledPlugins).length > 0)
    settings.enabledPlugins = enabledPlugins;
  if (Object.keys(extraKnownMarketplaces).length > 0)
    settings.extraKnownMarketplaces = extraKnownMarketplaces;
  writeFileSync(
    join(claudeDir, "settings.json"),
    `${JSON.stringify(settings, null, 2)}\n`,
  );
  // credentials (session auth)
  if (inputs.credentials) {
    writeFileSync(join(claudeDir, ".credentials.json"), inputs.credentials);
  }
  // gitconfig — pulled from host (sans [credential]) plus `safe.directory = *`
  // so git tolerates bind-mounted .git dirs with foreign uid.
  const homeAgent = join(dir, "home/agent");
  mkdirSync(homeAgent, { recursive: true });
  writeFileSync(join(homeAgent, ".gitconfig"), buildSandboxGitconfig());
  // /etc/sandbox-persistent.sh
  const etcDir = join(dir, "etc");
  mkdirSync(etcDir, { recursive: true });
  const envLines = `${Object.entries(inputs.env ?? {})
    .map(([k, v]) => `export ${k}=${shSingleQuote(v)}`)
    .join("\n")}\n`;
  writeFileSync(join(etcDir, "sandbox-persistent.sh"), envLines);
  return { dir };
}
