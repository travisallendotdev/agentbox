import { create as tarCreate } from "tar";
import { readdirSync } from "node:fs";

function sbxBin(): string {
  return process.env.AGENTBOX_SBX_BIN ?? "sbx";
}

// Soft cap on the base64-encoded payload to stay safely under typical
// Linux ARG_MAX (~128 KB). Above this we abort with a clear error so the
// failure mode is "your skills are too large", not a confusing exec error.
const MAX_BASE64_BYTES = 96 * 1024;

/**
 * Pack `stagingDir` and unpack it inside the sandbox.
 *
 * sbx exec does not propagate stdin EOF from the host to the in-VM process —
 * a host-side close of stdin (FileSink end, Uint8Array stdin, /dev/null
 * redirection) all leave the in-VM stdin permanently open, so any reader
 * (`tar -xf -`, `cat`, …) hangs forever. Workaround: embed the tar bytes
 * as a base64 string in the shell command, then decode and pipe inside
 * the VM. The decode→tar pipe is local to the VM and EOFs normally.
 */
export async function injectFiles(sandbox: string, stagingDir: string, destInsideSandbox: string): Promise<void> {
  // List top-level entries explicitly instead of ["."] — including "." in the
  // tar adds a "./" entry whose recorded mode comes from the staging dir
  // (mkdtemp creates dirs with 0700). Extracting that with -C / as root
  // chmods / to 0700, which breaks the container at next start (the kernel
  // can no longer resolve binaries on PATH; sleep infinity exits 127).
  const topLevel = readdirSync(stagingDir);
  if (topLevel.length === 0) return;
  // portable: strip uid/gid/mtime so the archive doesn't carry the host
  // user's UID (501) into the VM, where it has no agent meaning. Files
  // extract as root and we chown to agent below.
  const tarStream = tarCreate({ cwd: stagingDir, gzip: false, portable: true }, topLevel);
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

  const b64 = Buffer.from(buf).toString("base64");
  if (b64.length > MAX_BASE64_BYTES) {
    throw new Error(
      `inject payload too large (${b64.length} base64 bytes > ${MAX_BASE64_BYTES}); ` +
        `reduce the size of your skills or hooks (current limit avoids exceeding shell ARG_MAX)`,
    );
  }

  // Extract as root: the payload writes to /etc/sandbox-persistent.sh which
  // is owned by root in the template. After extraction:
  //   1. chown /home/agent files to agent so claude can write its state
  //   2. lock down .credentials.json to 0600 — claude refuses to use a
  //      credential file with looser perms (silent failure: blank screen).
  // chown/chmod failures are tolerated for tests where there's no `agent`
  // user and dest is a tmp dir.
  const dest = shSingleQuote(destInsideSandbox);
  const script = [
    `printf '%s' '${b64}' | base64 -d | tar -xf - -C ${dest}`,
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
    throw new Error(`sbx exec tar failed (code ${code}): ${stderr}\n${stdout}`);
  }
}

function shSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
