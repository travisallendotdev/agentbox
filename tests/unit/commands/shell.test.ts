import { expect, test } from "bun:test";
import { shell } from "../../../src/commands/shell.ts";

test("shell errors when name is missing", async () => {
  const code = await shell([]);
  expect(code).not.toBe(0);
});
