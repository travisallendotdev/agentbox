import { create as tarCreate } from "tar";

function sbxBin(): string {
  return process.env.AGENTBOX_SBX_BIN ?? "sbx";
}

/**
 * Pack `stagingDir` as a tar stream and pipe it into
 *   sbx exec <sandbox> tar -xf - -C <destInsideSandbox>
 */
export async function injectFiles(sandbox: string, stagingDir: string, destInsideSandbox: string): Promise<void> {
  const proc = Bun.spawn({
    cmd: [sbxBin(), "exec", sandbox, "tar", "-xf", "-", "-C", destInsideSandbox],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  const tarStream = tarCreate({ cwd: stagingDir, gzip: false }, ["."]);
  const writer = proc.stdin;
  for await (const chunk of tarStream as AsyncIterable<Uint8Array>) {
    writer.write(chunk);
  }
  writer.end();

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`sbx exec tar failed (code ${code}): ${stderr}\n${stdout}`);
  }
}
