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

  // Buffer the entire tar stream, then write+end in one shot. The payload is
  // small (skills + a few config files), and a single awaited write+end avoids
  // a Bun FileSink quirk where chunked writes followed by a non-awaited end()
  // can leave the subprocess stdin open — which causes the in-sandbox `tar` to
  // block forever waiting for EOF.
  const tarStream = tarCreate({ cwd: stagingDir, gzip: false }, ["."]);
  const chunks: Uint8Array[] = [];
  for await (const chunk of tarStream as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  const totalLen = chunks.reduce((n, c) => n + c.length, 0);
  const buf = new Uint8Array(totalLen);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.length;
  }
  proc.stdin.write(buf);
  await proc.stdin.end();

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`sbx exec tar failed (code ${code}): ${stderr}\n${stdout}`);
  }
}
