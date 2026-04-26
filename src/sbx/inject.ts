import { create as tarCreate } from "tar";

function sbxBin(): string {
  return process.env.AGENTBOX_SBX_BIN ?? "sbx";
}

/**
 * Pack `stagingDir` as a tar stream and pipe it into
 *   sbx exec <sandbox> tar -xf - -C <destInsideSandbox>
 *
 * Buffer the tar payload and pass it as `stdin: Uint8Array`. Awaiting
 * `proc.stdin.end()` on a FileSink is not enough — it does not always
 * propagate EOF through `sbx exec` to the in-VM `tar -xf -`, which then
 * blocks indefinitely. Passing a typed array makes Bun write the bytes and
 * close stdin atomically, which delivers EOF reliably.
 */
export async function injectFiles(sandbox: string, stagingDir: string, destInsideSandbox: string): Promise<void> {
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

  const proc = Bun.spawn({
    cmd: [sbxBin(), "exec", sandbox, "tar", "-xf", "-", "-C", destInsideSandbox],
    stdin: buf,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`sbx exec tar failed (code ${code}): ${stderr}\n${stdout}`);
  }
}
