import { test, expect, beforeEach, afterEach } from "bun:test";
import { buildSandboxGitconfig } from "../../../src/config/host-gitconfig.ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const orig = process.env.HOME;
let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "agbx-hgc-"));
  process.env.HOME = home;
});
afterEach(() => { process.env.HOME = orig; });

test("returns a [safe] block when there is no host gitconfig", () => {
  const out = buildSandboxGitconfig();
  expect(out).toBe("[safe]\n\tdirectory = *\n");
});

test("preserves user/alias sections from host gitconfig", () => {
  writeFileSync(join(home, ".gitconfig"), [
    "[user]",
    "\tname = Travis",
    "\temail = travis@example.com",
    "[alias]",
    "\tco = checkout",
  ].join("\n"));
  const out = buildSandboxGitconfig();
  expect(out).toContain("[user]");
  expect(out).toContain("name = Travis");
  expect(out).toContain("[alias]");
  expect(out).toMatch(/\[safe\]\n\tdirectory = \*\n$/);
});

test("strips both bare and qualified [credential] sections", () => {
  writeFileSync(join(home, ".gitconfig"), [
    "[user]",
    "\tname = T",
    "[credential]",
    "\thelper = osxkeychain",
    "[credential \"https://github.com\"]",
    "\thelper = !gh auth git-credential",
    "[alias]",
    "\tst = status",
  ].join("\n"));
  const out = buildSandboxGitconfig();
  expect(out).not.toContain("credential");
  expect(out).not.toContain("osxkeychain");
  expect(out).not.toContain("gh auth git-credential");
  expect(out).toContain("[user]");
  expect(out).toContain("[alias]");
});

test("section detection is case-insensitive on the section name", () => {
  writeFileSync(join(home, ".gitconfig"), [
    "[user]",
    "\tname = T",
    "[Credential]",
    "\thelper = osxkeychain",
  ].join("\n"));
  const out = buildSandboxGitconfig();
  expect(out).not.toContain("osxkeychain");
});
