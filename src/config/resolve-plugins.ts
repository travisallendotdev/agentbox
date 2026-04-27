import { join, isAbsolute, basename } from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";

export interface ResolvedPlugin {
  /** Marketplace name (synthetic `local` for path refs). */
  marketplace: string;
  /** Plugin name. */
  name: string;
  /** Resolved version. `local` for path refs; first directory under the plugin dir for cache refs. */
  version: string;
  /** Absolute host path to the plugin directory (the version dir, or the path for local refs). */
  path: string;
}

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

function listDirs(p: string): string[] {
  try {
    return readdirSync(p).filter((n) => statSync(join(p, n)).isDirectory());
  } catch {
    return [];
  }
}

/** Pick the lexically-greatest version dir; works for both semver-ish and commit hashes. */
function pickVersion(pluginDir: string): string | null {
  const versions = listDirs(pluginDir);
  if (versions.length === 0) return null;
  versions.sort();
  return versions[versions.length - 1] ?? null;
}

function findPluginInMarketplace(marketplace: string, pluginName: string): { version: string; path: string } | null {
  const pluginDir = join(claudeHome(), "plugins", "cache", marketplace, pluginName);
  if (!existsSync(pluginDir)) return null;
  const version = pickVersion(pluginDir);
  if (!version) return null;
  return { version, path: join(pluginDir, version) };
}

function findPluginAcrossMarketplaces(pluginName: string): { marketplace: string; version: string; path: string } | null {
  const cacheRoot = join(claudeHome(), "plugins", "cache");
  if (!existsSync(cacheRoot)) return null;
  for (const marketplace of listDirs(cacheRoot)) {
    const found = findPluginInMarketplace(marketplace, pluginName);
    if (found) return { marketplace, ...found };
  }
  return null;
}

export async function resolvePlugin(ref: string): Promise<ResolvedPlugin> {
  // Path form
  if (ref.startsWith("/") || ref.startsWith("~/") || isAbsolute(ref)) {
    const expanded = expandHome(ref);
    if (!existsSync(expanded)) throw new Error(`Plugin path not found: ${ref}`);
    if (!statSync(expanded).isDirectory()) throw new Error(`Plugin path is not a directory: ${ref}`);
    return { marketplace: "local", name: basename(expanded), version: "local", path: expanded };
  }
  // Marketplace-qualified form: <marketplace>:<plugin>
  if (ref.includes(":")) {
    const parts = ref.split(":", 2);
    const marketplace = parts[0]!;
    const name = parts[1]!;
    const found = findPluginInMarketplace(marketplace, name);
    if (!found) throw new Error(`Plugin not found in marketplace: ${ref}`);
    return { marketplace, name, version: found.version, path: found.path };
  }
  // Bare name — search all marketplaces
  const found = findPluginAcrossMarketplaces(ref);
  if (!found) throw new Error(`Plugin not found in any cached marketplace: ${ref}`);
  return { marketplace: found.marketplace, name: ref, version: found.version, path: found.path };
}

export async function resolveAllPlugins(refs: string[]): Promise<ResolvedPlugin[]> {
  const out: ResolvedPlugin[] = [];
  for (const ref of refs) out.push(await resolvePlugin(ref));
  return out;
}
