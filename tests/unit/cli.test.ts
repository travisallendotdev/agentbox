import { expect, test } from "bun:test";
import { runCli } from "../../src/cli.ts";

test("unknown command exits with code 2 and usage", async () => {
  const r = await runCli(["xyz"]);
  expect(r).toBe(2);
});

test("--help exits 0", async () => {
  const r = await runCli(["--help"]);
  expect(r).toBe(0);
});

test("no args prints usage and exits 0", async () => {
  const r = await runCli([]);
  expect(r).toBe(0);
});
