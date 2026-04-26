import { join } from "node:path";

export interface HomePaths {
  root: string;
  registry: string;
  logsDir: string;
  sandboxesDir: string;
  sandboxDir(name: string): string;
  repoParentDir(name: string): string;
  logFile(name: string, timestamp: string): string;
}

export function homePaths(): HomePaths {
  const root = process.env.AGENTBOX_HOME ?? join(process.env.HOME!, ".agentbox");
  return {
    root,
    registry: join(root, "registry.json"),
    logsDir: join(root, "logs"),
    sandboxesDir: join(root, "sandboxes"),
    sandboxDir: (name) => join(root, "sandboxes", name),
    repoParentDir: (name) => join(root, "sandboxes", name, "repos"),
    logFile: (name, ts) => join(root, "logs", `${name}-${ts}.log`),
  };
}
