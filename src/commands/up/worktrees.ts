import { mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homePaths } from "../../paths.ts";
import { addWorktree, ensureBranch, removeWorktree } from "../../git/worktree.ts";
import type { ResolvedRepo } from "../../config/resolve-repos.ts";

export async function createHostWorktrees(sandboxName: string, repos: ResolvedRepo[]): Promise<void> {
  const parent = homePaths().repoParentDir(sandboxName);
  mkdirSync(parent, { recursive: true });
  const created: { repoDir: string; worktreePath: string }[] = [];
  try {
    for (const r of repos) {
      if (r.source !== "local") continue;
      const wt = join(parent, r.name);
      await ensureBranch(r.path, r.branch);
      await addWorktree(r.path, wt, r.branch);
      created.push({ repoDir: r.path, worktreePath: wt });
    }
  } catch (e) {
    for (const c of created.reverse()) {
      try { await removeWorktree(c.repoDir, c.worktreePath, { force: true }); }
      catch (cleanupErr) {
        console.warn(`agentbox: rollback warning: failed to remove worktree ${c.worktreePath}: ${(cleanupErr as Error).message}`);
      }
    }
    if (existsSync(parent)) rmSync(parent, { recursive: true, force: true });
    throw e;
  }
}

export async function removeHostWorktrees(
  sandboxName: string,
  repos: ResolvedRepo[],
  opts: { force: boolean },
): Promise<void> {
  const parent = homePaths().repoParentDir(sandboxName);
  for (const r of repos) {
    if (r.source !== "local") continue;
    const wt = join(parent, r.name);
    if (!existsSync(wt)) continue;
    if (!existsSync(r.path)) {
      // Source repo gone; can't use git worktree remove, but we can still clean up the worktree dir.
      rmSync(wt, { recursive: true, force: true });
      continue;
    }
    await removeWorktree(r.path, wt, { force: opts.force });
  }
  if (existsSync(parent)) rmSync(parent, { recursive: true, force: true });
}
