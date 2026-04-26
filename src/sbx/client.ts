export interface SbxResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function sbxBin(): string {
  return process.env.AGENTBOX_SBX_BIN ?? "sbx";
}

export async function runSbx(args: string[]): Promise<SbxResult> {
  const proc = Bun.spawn({
    cmd: [sbxBin(), ...args],
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

/**
 * Run sbx with stdio inherited so the user sees the agent TUI directly.
 * Returns the exit code only.
 */
export async function runSbxInherit(args: string[]): Promise<number> {
  const proc = Bun.spawn({
    cmd: [sbxBin(), ...args],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return await proc.exited;
}
