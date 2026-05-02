function sbxBin(): string {
  return process.env.AGENTBOX_SBX_BIN ?? "sbx";
}

/**
 * Copy `stagingDir`'s contents into the sandbox at `destInsideSandbox`.
 *
 * The staging dir is bind-mounted into the VM via `sbx create`'s extra-path
 * argument (a read-only virtiofs mount). sbx maps host paths to identical
 * in-VM paths, so `stagingDir` itself is the in-VM mount point. Inject is
 * therefore just a `cp -r <mount>/. <dest>` inside the VM, followed by:
 *   1. chown -R agent:agent /home/agent — the staging dir is owned by the
 *      host user (UID 501); cp -r as root creates files owned by root, then
 *      chown gives /home/agent files to the agent user.
 *   2. chmod 600 .credentials.json — claude refuses to use a credential file
 *      with looser perms (silent failure: blank-screen launch).
 *
 * chown/chmod failures are tolerated for tests where there's no `agent` user
 * and dest is a tmp dir.
 */
export async function injectFiles(
  sandbox: string,
  stagingDir: string,
  destInsideSandbox: string,
): Promise<void> {
  const src = shSingleQuote(stagingDir);
  const dest = shSingleQuote(destInsideSandbox);
  const script = [
    `cp -r ${src}/. ${dest}`,
    `if [ -d ${dest}/home/agent ]; then chown -R agent:agent ${dest}/home/agent 2>/dev/null || true; fi`,
    `if [ -f ${dest}/home/agent/.claude/.credentials.json ]; then chmod 600 ${dest}/home/agent/.claude/.credentials.json; fi`,
  ].join(" && ");
  const proc = Bun.spawn({
    cmd: [sbxBin(), "exec", "-u", "root", sandbox, "sh", "-c", script],
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(
      `sbx exec inject failed (code ${code}): ${stderr}\n${stdout}`,
    );
  }
}

function shSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
