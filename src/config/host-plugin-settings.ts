import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

interface MarketplaceSource { [k: string]: unknown }

function claudeHome(): string {
  if (process.env.CLAUDE_HOME) return process.env.CLAUDE_HOME;
  const home = process.env.HOME;
  if (!home) throw new Error("HOME environment variable not set");
  return join(home, ".claude");
}

interface HostSettings {
  extraKnownMarketplaces?: Record<string, MarketplaceSource>;
}

/** Read the host user's `extraKnownMarketplaces` block. Empty object if no settings or not configured. */
export function readHostExtraMarketplaces(): Record<string, MarketplaceSource> {
  const path = join(claudeHome(), "settings.json");
  if (!existsSync(path)) return {};
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as HostSettings;
    return data.extraKnownMarketplaces ?? {};
  } catch {
    return {};
  }
}
