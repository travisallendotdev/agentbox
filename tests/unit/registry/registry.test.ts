import { test, expect, beforeEach } from "bun:test";
import {
  readRegistry, addEntry, removeEntry, getEntry, listEntries,
  type RegistryEntry,
} from "../../../src/registry/registry.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "agbx-reg-"));
  process.env.AGENTBOX_HOME = home;
});

const sample: RegistryEntry = {
  name: "foo",
  config_path: "/x/y.yaml",
  mode: "durable",
  created_at: "2026-04-25T00:00:00Z",
  sbx_sandbox_id: "sbx_abc",
  config_hash: "deadbeef",
};

test("readRegistry returns empty when file is absent", async () => {
  expect(await readRegistry()).toEqual({});
});

test("addEntry then getEntry round-trips", async () => {
  await addEntry(sample);
  expect(await getEntry("foo")).toEqual(sample);
});

test("addEntry rejects duplicate name without replace flag", async () => {
  await addEntry(sample);
  await expect(addEntry(sample)).rejects.toThrow(/already exists/i);
});

test("addEntry with replace=true overwrites", async () => {
  await addEntry(sample);
  const updated = { ...sample, sbx_sandbox_id: "sbx_xyz" };
  await addEntry(updated, { replace: true });
  expect((await getEntry("foo"))?.sbx_sandbox_id).toBe("sbx_xyz");
});

test("removeEntry is idempotent", async () => {
  await addEntry(sample);
  await removeEntry("foo");
  await removeEntry("foo"); // no throw
  expect(await getEntry("foo")).toBeUndefined();
});

test("listEntries returns all entries", async () => {
  await addEntry(sample);
  await addEntry({ ...sample, name: "bar" });
  const list = await listEntries();
  expect(list.map((e) => e.name).sort()).toEqual(["bar", "foo"]);
});

test("concurrent addEntry calls serialize via lock", async () => {
  // Ten parallel adds with distinct names should all succeed.
  const tasks = Array.from({ length: 10 }, (_, i) =>
    addEntry({ ...sample, name: `n${i}` }),
  );
  await Promise.all(tasks);
  expect((await listEntries()).length).toBe(10);
});
