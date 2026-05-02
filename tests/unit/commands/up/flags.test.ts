import { expect, test } from "bun:test";
import { parseUpFlags } from "../../../../src/commands/up/flags.ts";

test("parses positional config path and flags", () => {
  const r = parseUpFlags(["x.yaml", "--name", "foo", "--replace", "--verbose"]);
  expect(r.configPath).toBe("x.yaml");
  expect(r.name).toBe("foo");
  expect(r.replace).toBe(true);
  expect(r.verbose).toBe(true);
});

test("supports --keep and --keep-on-error", () => {
  const r = parseUpFlags(["x.yaml", "--keep", "--keep-on-error"]);
  expect(r.keep).toBe(true);
  expect(r.keepOnError).toBe(true);
});

test("missing config path is a usage error", () => {
  expect(() => parseUpFlags([])).toThrow(/config path/i);
});

test("rejects unknown flags", () => {
  expect(() => parseUpFlags(["x.yaml", "--bogus"])).toThrow(/unknown/i);
});

test("--name with no value throws AgentboxError", () => {
  expect(() => parseUpFlags(["x.yaml", "--name"])).toThrow(/--name requires/i);
});

test("--name followed by a flag throws (does not silently consume the flag)", () => {
  expect(() => parseUpFlags(["x.yaml", "--name", "--replace"])).toThrow(
    /--name requires/i,
  );
});
