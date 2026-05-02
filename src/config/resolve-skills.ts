import { existsSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";

function claudeHome(): string {
  if (process.env.CLAUDE_HOME) return process.env.CLAUDE_HOME;
  const home = process.env.HOME;
  if (!home) throw new Error("HOME environment variable not set");
  return join(home, ".claude");
}

function expandHome(p: string): string {
  if (p.startsWith("~/")) {
    const home = process.env.HOME;
    if (!home) throw new Error("HOME environment variable not set");
    return join(home, p.slice(2));
  }
  return p;
}

function findInPluginCache(
  pluginName: string,
  skillName: string,
): string | null {
  const cacheRoot = join(claudeHome(), "plugins", "cache");
  if (!existsSync(cacheRoot)) return null;
  for (const marketplace of readdirSync(cacheRoot)) {
    const pluginDir = join(cacheRoot, marketplace, pluginName);
    if (!existsSync(pluginDir)) continue;
    // pluginDir/<version>/skills/<skillName>
    for (const version of readdirSync(pluginDir)) {
      const candidate = join(pluginDir, version, "skills", skillName);
      if (existsSync(candidate) && statSync(candidate).isDirectory())
        return candidate;
    }
  }
  return null;
}

export async function resolveSkill(ref: string): Promise<string> {
  // Path form (absolute or ~-prefixed)
  if (ref.startsWith("/") || ref.startsWith("~/") || isAbsolute(ref)) {
    const expanded = expandHome(ref);
    if (!existsSync(expanded)) throw new Error(`Skill path not found: ${ref}`);
    if (!statSync(expanded).isDirectory())
      throw new Error(`Skill path is not a directory: ${ref}`);
    return expanded;
  }
  // Plugin form: <plugin>:<skill>
  if (ref.includes(":")) {
    const parts = ref.split(":", 2);
    const plugin = parts[0]!;
    const skill = parts[1]!;
    const found = findInPluginCache(plugin, skill);
    if (!found) throw new Error(`Plugin skill not found: ${ref}`);
    return found;
  }
  // Bare name → ~/.claude/skills/<name>
  const candidate = join(claudeHome(), "skills", ref);
  if (!existsSync(candidate))
    throw new Error(`Skill not found in ${claudeHome()}/skills: ${ref}`);
  if (!statSync(candidate).isDirectory())
    throw new Error(`Skill is not a directory: ${ref}`);
  return candidate;
}

export async function resolveAllSkills(
  refs: string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const ref of refs) out[ref] = await resolveSkill(ref);
  return out;
}
