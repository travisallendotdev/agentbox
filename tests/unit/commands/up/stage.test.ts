import { beforeEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stageInjection } from "../../../../src/commands/up/stage.ts";

let workdir: string;
beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "agbx-stg-"));
});

test("stages skills, settings.json, and env file under correct subpaths", async () => {
  const skillSrc = join(workdir, "skill-src");
  mkdirSync(skillSrc, { recursive: true });
  writeFileSync(join(skillSrc, "skill.md"), "hello");

  const stage = await stageInjection({
    skillSources: { "coding-standards": skillSrc },
    plugins: [],
    hooks: { PostToolUse: [{ matcher: "Bash", command: "echo hi" }] },
    env: { FOO: "bar", BAZ: "qux" },
  });

  // skills land at home/agent/.claude/skills/<name>
  expect(
    existsSync(
      join(stage.dir, "home/agent/.claude/skills/coding-standards/skill.md"),
    ),
  ).toBe(true);
  // settings.json
  const settings = JSON.parse(
    readFileSync(join(stage.dir, "home/agent/.claude/settings.json"), "utf8"),
  );
  expect(settings.hooks.PostToolUse[0].command).toBe("echo hi");
  // env file
  const env = readFileSync(
    join(stage.dir, "etc/sandbox-persistent.sh"),
    "utf8",
  );
  expect(env).toContain("export FOO='bar'");
  expect(env).toContain("export BAZ='qux'");
});

test("env values are single-quoted with embedded quotes escaped", async () => {
  const stage = await stageInjection({
    skillSources: {},
    plugins: [],
    hooks: undefined,
    env: { TRICKY: "it's tricky" },
  });
  const env = readFileSync(
    join(stage.dir, "etc/sandbox-persistent.sh"),
    "utf8",
  );
  expect(env).toContain(`export TRICKY='it'\\''s tricky'`);
});

test("empty inputs produce empty (but valid) settings.json and env file", async () => {
  const stage = await stageInjection({
    skillSources: {},
    plugins: [],
    hooks: undefined,
    env: undefined,
  });
  const settings = JSON.parse(
    readFileSync(join(stage.dir, "home/agent/.claude/settings.json"), "utf8"),
  );
  expect(settings).toEqual({});
  const env = readFileSync(
    join(stage.dir, "etc/sandbox-persistent.sh"),
    "utf8",
  );
  expect(env).toBe("\n"); // empty entries → just a newline
});

test("writes credentials.json when credentials provided", async () => {
  const stage = await stageInjection({
    skillSources: {},
    plugins: [],
    hooks: undefined,
    env: undefined,
    credentials: '{"oauth_token":"fake"}',
  });
  const creds = readFileSync(
    join(stage.dir, "home/agent/.claude/.credentials.json"),
    "utf8",
  );
  expect(creds).toBe('{"oauth_token":"fake"}');
});

test("stages plugin trees and merges enabledPlugins into settings.json", async () => {
  const pluginSrc = join(workdir, "plugin-src");
  mkdirSync(join(pluginSrc, "skills/foo"), { recursive: true });
  writeFileSync(join(pluginSrc, "skills/foo/SKILL.md"), "# foo");
  // node_modules and .git should be excluded
  mkdirSync(join(pluginSrc, "node_modules/junk"), { recursive: true });
  writeFileSync(
    join(pluginSrc, "node_modules/junk/big.bin"),
    "should not copy",
  );
  mkdirSync(join(pluginSrc, ".git"), { recursive: true });
  writeFileSync(join(pluginSrc, ".git/HEAD"), "ref");

  const stage = await stageInjection({
    skillSources: {},
    plugins: [
      {
        marketplace: "my-mp",
        name: "myplug",
        version: "1.0.0",
        path: pluginSrc,
      },
    ],
    hooks: undefined,
    env: undefined,
  });

  // Plugin tree lands at the canonical cache path
  const dst = join(
    stage.dir,
    "home/agent/.claude/plugins/cache/my-mp/myplug/1.0.0",
  );
  expect(existsSync(join(dst, "skills/foo/SKILL.md"))).toBe(true);
  // Excluded
  expect(existsSync(join(dst, "node_modules"))).toBe(false);
  expect(existsSync(join(dst, ".git"))).toBe(false);
  // settings.json carries enabledPlugins
  const settings = JSON.parse(
    readFileSync(join(stage.dir, "home/agent/.claude/settings.json"), "utf8"),
  );
  expect(settings.enabledPlugins).toEqual({ "myplug@my-mp": true });
});

test("merges extraKnownMarketplaces from host settings for non-builtin marketplaces", async () => {
  // Synthesise a host CLAUDE_HOME with an extraKnownMarketplaces entry
  const fakeHome = mkdtempSync(join(tmpdir(), "agbx-home-"));
  writeFileSync(
    join(fakeHome, "settings.json"),
    JSON.stringify({
      extraKnownMarketplaces: {
        "my-mp": { source: { source: "github", repo: "x/y" } },
        other: { source: { source: "github", repo: "a/b" } },
      },
    }),
  );
  const orig = process.env.CLAUDE_HOME;
  process.env.CLAUDE_HOME = fakeHome;
  try {
    const pluginSrc = join(workdir, "plugin-src2");
    mkdirSync(pluginSrc, { recursive: true });
    const stage = await stageInjection({
      skillSources: {},
      plugins: [
        {
          marketplace: "my-mp",
          name: "myplug",
          version: "1.0.0",
          path: pluginSrc,
        },
      ],
      hooks: undefined,
      env: undefined,
    });
    const settings = JSON.parse(
      readFileSync(join(stage.dir, "home/agent/.claude/settings.json"), "utf8"),
    );
    // Only the plugin's marketplace is carried through, not unrelated entries
    expect(settings.extraKnownMarketplaces).toEqual({
      "my-mp": { source: { source: "github", repo: "x/y" } },
    });
  } finally {
    process.env.CLAUDE_HOME = orig;
  }
});

test("writes home/agent/.gitconfig with host config minus [credential] sections plus [safe] directory = *", async () => {
  const fakeHome = mkdtempSync(join(tmpdir(), "agbx-home-gc-"));
  writeFileSync(
    join(fakeHome, ".gitconfig"),
    [
      "[user]",
      "\tname = Travis",
      "\temail = travis@example.com",
      "[credential]",
      "\thelper = osxkeychain",
      '[credential "https://github.com"]',
      "\thelper = !gh auth git-credential",
      "[alias]",
      "\tco = checkout",
      "",
    ].join("\n"),
  );
  const orig = process.env.HOME;
  process.env.HOME = fakeHome;
  try {
    const stage = await stageInjection({
      skillSources: {},
      plugins: [],
      hooks: undefined,
      env: undefined,
    });
    const gc = readFileSync(join(stage.dir, "home/agent/.gitconfig"), "utf8");
    expect(gc).toContain("[user]");
    expect(gc).toContain("name = Travis");
    expect(gc).toContain("[alias]");
    expect(gc).not.toContain("credential");
    expect(gc).not.toContain("osxkeychain");
    expect(gc).toContain("[safe]");
    expect(gc).toContain("directory = *");
  } finally {
    process.env.HOME = orig;
  }
});

test("writes a minimal gitconfig (just [safe]) when host has none", async () => {
  const fakeHome = mkdtempSync(join(tmpdir(), "agbx-home-nogc-"));
  const orig = process.env.HOME;
  process.env.HOME = fakeHome;
  try {
    const stage = await stageInjection({
      skillSources: {},
      plugins: [],
      hooks: undefined,
      env: undefined,
    });
    const gc = readFileSync(join(stage.dir, "home/agent/.gitconfig"), "utf8");
    expect(gc).toContain("[safe]");
    expect(gc).toContain("directory = *");
    expect(gc).not.toContain("[user]");
  } finally {
    process.env.HOME = orig;
  }
});

test("does not write credentials.json when credentials omitted", async () => {
  const stage = await stageInjection({
    skillSources: {},
    plugins: [],
    hooks: undefined,
    env: undefined,
  });
  expect(
    existsSync(join(stage.dir, "home/agent/.claude/.credentials.json")),
  ).toBe(false);
});
