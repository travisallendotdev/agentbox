import type { ResolvedRepo } from "../../config/resolve-repos.ts";
import { AgentboxError } from "../../errors.ts";
import { homePaths } from "../../paths.ts";
import { runSbx } from "../../sbx/client.ts";

export async function cloneGitRepos(
  sandboxName: string,
  repos: ResolvedRepo[],
): Promise<void> {
  const parent = homePaths().repoParentDir(sandboxName);
  for (const r of repos) {
    if (r.source !== "git") continue;
    const dest =
      r.place === "vm" ? `/home/agent/repos/${r.name}` : `${parent}/${r.name}`;
    const branchArgs = r.branch ? `--branch ${r.branch}` : "";
    const cmd = `mkdir -p $(dirname ${dest}) && git clone ${branchArgs} ${r.url} ${dest}`;
    const result = await runSbx(["exec", sandboxName, "bash", "-lc", cmd]);
    if (result.exitCode !== 0) {
      throw new AgentboxError(
        `git clone failed for ${r.url}: ${result.stderr.trim()}`,
        {
          fix: "Check git URL, network policy, and credentials inside the sandbox",
        },
      );
    }
  }
}
