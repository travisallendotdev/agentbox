import { test, expect, beforeEach } from "bun:test";
import { ls } from "../../src/commands/ls.ts";
import { addEntry } from "../../src/registry/registry.ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let workdir: string;
beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "agbx-ls-"));
  process.env.AGENTBOX_HOME = workdir;
});

function fakeSbxList(json: string): string {
  const p = join(workdir, "fake-sbx.sh");
  writeFileSync(
    p,
    `#!/bin/sh\nif [ "$1 $2" = "ls --json" ]; then\nprintf '%s' '${json.replace(/'/g, "'\\''")}'\nfi\nexit 0\n`,
    { mode: 0o755 },
  );
  return p;
}

test("shows registered sandboxes with running/stopped/orphaned/unmanaged classification", async () => {
  const cfg = join(workdir, "c.yaml");
  writeFileSync(cfg, "mode: durable\n");
  await addEntry({ name: "foo", config_path: cfg, mode: "durable", created_at: "x", sbx_sandbox_id: "foo", config_hash: "0" });
  await addEntry({ name: "ghost", config_path: cfg, mode: "durable", created_at: "x", sbx_sandbox_id: "ghost", config_hash: "0" });
  process.env.AGENTBOX_SBX_BIN = fakeSbxList(JSON.stringify([
    { name: "foo", state: "running" },
    { name: "stranger", state: "stopped" },
  ]));
  const chunks: string[] = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  // @ts-ignore
  process.stdout.write = (b: any) => { chunks.push(String(b)); return true; };
  try {
    const code = await ls([]);
    expect(code).toBe(0);
  } finally {
    process.stdout.write = origWrite;
  }
  const out = chunks.join("");
  expect(out).toContain("foo");
  expect(out).toContain("running");
  expect(out).toContain("ghost");
  expect(out).toContain("orphaned");
  expect(out).toContain("stranger");
  expect(out).toContain("unmanaged");
});

test("ls with empty registry and empty sbx prints 'No sandboxes.'", async () => {
  process.env.AGENTBOX_SBX_BIN = fakeSbxList("[]");
  const chunks: string[] = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  // @ts-ignore
  process.stdout.write = (b: any) => { chunks.push(String(b)); return true; };
  try {
    const code = await ls([]);
    expect(code).toBe(0);
  } finally {
    process.stdout.write = origWrite;
  }
  expect(chunks.join("")).toContain("No sandboxes");
});
