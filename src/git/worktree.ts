import { realpathSync } from "node:fs";

async function git(repoDir: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  const proc = Bun.spawn({
    cmd: ["git", "-C", repoDir, ...args],
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

async function gitOk(repoDir: string, args: string[]): Promise<string> {
  const r = await git(repoDir, args);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
  return r.stdout;
}

export async function branchExists(repoDir: string, branch: string): Promise<boolean> {
  const r = await git(repoDir, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
  return r.code === 0;
}

export async function ensureBranch(repoDir: string, branch: string): Promise<void> {
  if (await branchExists(repoDir, branch)) return;
  await gitOk(repoDir, ["branch", branch]);
}

export async function addWorktree(repoDir: string, worktreePath: string, branch: string): Promise<void> {
  await gitOk(repoDir, ["worktree", "add", worktreePath, branch]);
}

export async function removeWorktree(repoDir: string, worktreePath: string, opts?: { force?: boolean }): Promise<void> {
  const args = ["worktree", "remove", worktreePath];
  if (opts?.force) args.push("--force");
  await gitOk(repoDir, args);
}

export interface WorktreeInfo { path: string; branch: string | null; head: string }

export async function listWorktrees(repoDir: string): Promise<WorktreeInfo[]> {
  const out = await gitOk(repoDir, ["worktree", "list", "--porcelain"]);
  const blocks = out.split("\n\n").filter(Boolean);
  return blocks.map((block) => {
    const map: Record<string, string> = {};
    for (const line of block.split("\n")) {
      const [k, ...rest] = line.split(" ");
      if (k) {
        map[k] = rest.join(" ");
      }
    }
    return {
      path: map.worktree ?? "",
      head: map.HEAD ?? "",
      branch: map.branch ? map.branch.replace(/^refs\/heads\//, "") : null,
    };
  });
}
