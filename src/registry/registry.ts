import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import lockfile from "proper-lockfile";
import { homePaths } from "../paths.ts";

export interface RegistryEntry {
  name: string;
  config_path: string;
  mode: "durable" | "ephemeral";
  created_at: string;
  sbx_sandbox_id: string;
  config_hash: string;
}

export type Registry = Record<string, RegistryEntry>;

async function ensureRegistryFile(): Promise<string> {
  const path = homePaths().registry;
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) await Bun.write(path, "{}\n");
  return path;
}

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const path = await ensureRegistryFile();
  const release = await lockfile.lock(path, { retries: { retries: 20, minTimeout: 25, maxTimeout: 200 } });
  try {
    return await fn();
  } finally {
    await release();
  }
}

export async function readRegistry(): Promise<Registry> {
  const path = await ensureRegistryFile();
  const text = await Bun.file(path).text();
  return JSON.parse(text || "{}");
}

async function writeRegistry(reg: Registry): Promise<void> {
  const path = await ensureRegistryFile();
  await Bun.write(path, JSON.stringify(reg, null, 2) + "\n");
}

export async function addEntry(entry: RegistryEntry, opts?: { replace?: boolean }): Promise<void> {
  await withLock(async () => {
    const reg = await readRegistry();
    if (reg[entry.name] && !opts?.replace) {
      throw new Error(`Sandbox '${entry.name}' already exists in the registry. Use --replace to overwrite.`);
    }
    reg[entry.name] = entry;
    await writeRegistry(reg);
  });
}

export async function removeEntry(name: string): Promise<void> {
  await withLock(async () => {
    const reg = await readRegistry();
    delete reg[name];
    await writeRegistry(reg);
  });
}

export async function getEntry(name: string): Promise<RegistryEntry | undefined> {
  const reg = await readRegistry();
  return reg[name];
}

export async function listEntries(): Promise<RegistryEntry[]> {
  const reg = await readRegistry();
  return Object.values(reg);
}
