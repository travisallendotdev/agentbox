import { test, expect, beforeEach, afterEach } from "bun:test";
import { homePaths } from "../../src/paths.ts";

const origHome = process.env.AGENTBOX_HOME;
beforeEach(() => { process.env.AGENTBOX_HOME = "/tmp/agentbox-test"; });
afterEach(() => { process.env.AGENTBOX_HOME = origHome; });

test("paths derive from AGENTBOX_HOME when set", () => {
  const p = homePaths();
  expect(p.root).toBe("/tmp/agentbox-test");
  expect(p.registry).toBe("/tmp/agentbox-test/registry.json");
  expect(p.sandboxDir("foo")).toBe("/tmp/agentbox-test/sandboxes/foo");
  expect(p.repoParentDir("foo")).toBe("/tmp/agentbox-test/sandboxes/foo/repos");
  expect(p.logFile("foo", "20260425T120000")).toBe(
    "/tmp/agentbox-test/logs/foo-20260425T120000.log",
  );
});

test("default home is ~/.agentbox", () => {
  delete process.env.AGENTBOX_HOME;
  const p = homePaths();
  expect(p.root).toBe(`${process.env.HOME}/.agentbox`);
});
