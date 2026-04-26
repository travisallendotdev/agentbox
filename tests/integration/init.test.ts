import { test, expect, beforeEach } from "bun:test";
import { init } from "../../src/commands/init.ts";
import { AgentboxConfigSchema } from "../../src/config/schema.ts";
import { parse as parseYaml } from "yaml";
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let workdir: string;
beforeEach(() => { workdir = mkdtempSync(join(tmpdir(), "agbx-init-")); });

function captureStdout(): { restore: () => void; output: () => string } {
  const chunks: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  // @ts-ignore
  process.stdout.write = (b: any) => { chunks.push(String(b)); return true; };
  return {
    restore: () => { process.stdout.write = orig; },
    output: () => chunks.join(""),
  };
}

test("init with no args writes the example to stdout", async () => {
  const cap = captureStdout();
  let code: number;
  try { code = await init([]); } finally { cap.restore(); }
  expect(code).toBe(0);
  const out = cap.output();
  expect(out).toContain("mode: durable");
  expect(out).toContain("repos:");
  expect(out).toContain("skills:");
});

test("the generated YAML is parseable and schema-valid", async () => {
  const cap = captureStdout();
  try { await init([]); } finally { cap.restore(); }
  const out = cap.output();
  const parsed = parseYaml(out);
  const r = AgentboxConfigSchema.safeParse(parsed);
  if (!r.success) {
    console.error("Schema errors:", r.error.format());
  }
  expect(r.success).toBe(true);
});

test("init <path> writes to that file", async () => {
  const target = join(workdir, "out.yaml");
  const code = await init([target]);
  expect(code).toBe(0);
  expect(existsSync(target)).toBe(true);
  const text = readFileSync(target, "utf8");
  expect(text).toContain("mode: durable");
});

test("init <path> refuses to overwrite an existing file without --force", async () => {
  const target = join(workdir, "exists.yaml");
  writeFileSync(target, "do not touch");
  const code = await init([target]);
  expect(code).not.toBe(0);
  expect(readFileSync(target, "utf8")).toBe("do not touch");
});

test("init <path> --force overwrites an existing file", async () => {
  const target = join(workdir, "exists.yaml");
  writeFileSync(target, "do not touch");
  const code = await init([target, "--force"]);
  expect(code).toBe(0);
  const text = readFileSync(target, "utf8");
  expect(text).not.toBe("do not touch");
  expect(text).toContain("mode: durable");
});
