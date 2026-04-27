import { existsSync, realpathSync, statSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import type { Repo } from "./schema.ts";

export type ResolvedRepoLocal = {
  source: "local";
  path: string;        // absolute
  branch: string;      // resolved
  name: string;        // basename
};
export type ResolvedRepoGit = {
  source: "git";
  url: string;
  branch?: string;
  place: "workspace" | "vm";
  name: string;        // derived from URL basename
};
export type ResolvedRepo = ResolvedRepoLocal | ResolvedRepoGit;

function expandHome(p: string): string {
  if (p.startsWith("~/")) return join(process.env.HOME!, p.slice(2));
  if (!isAbsolute(p)) return join(process.cwd(), p);
  return p;
}

function gitUrlBasename(url: string): string {
  const last = url.split("/").pop() ?? url;
  return last.replace(/\.git$/, "");
}

export async function resolveRepos(repos: Repo[], sandboxName: string): Promise<ResolvedRepo[]> {
  const out: ResolvedRepo[] = [];
  const seen = new Set<string>();

  for (const repo of repos) {
    let resolved: ResolvedRepo;
    if (repo.source === "local") {
      const expanded = expandHome(repo.path);
      if (!existsSync(expanded)) throw new Error(`Local repo path does not exist: ${repo.path}`);
      if (!statSync(expanded).isDirectory()) throw new Error(`Local repo path is not a directory: ${repo.path}`);
      // Canonicalize symlinks: `git worktree add --relative-paths` resolves
      // them when computing the gitdir pointer, and the path we pass to `sbx
      // create` must match for the bind mount to land on the same in-VM path
      // the pointer expects. (On macOS `/tmp` → `/private/tmp` is the common
      // case that exposes this.)
      const abs = realpathSync(expanded);
      const gitDir = join(abs, ".git");
      if (!existsSync(gitDir)) throw new Error(`Local repo path is not a git repo: ${repo.path}`);
      resolved = {
        source: "local",
        path: abs,
        branch: repo.branch ?? `agentbox/${sandboxName}`,
        name: basename(abs),
      };
    } else {
      resolved = {
        source: "git",
        url: repo.url,
        branch: repo.branch,
        place: repo.place ?? "workspace",
        name: gitUrlBasename(repo.url),
      };
    }
    if (seen.has(resolved.name)) {
      throw new Error(`duplicate repo name '${resolved.name}' — use different paths/urls or restructure your config`);
    }
    seen.add(resolved.name);
    out.push(resolved);
  }
  return out;
}
