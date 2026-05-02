import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { homePaths } from "../paths.ts";

export interface Logger {
  path: string;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  phase<T>(name: string, fn: () => T | Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface LoggerOptions {
  verbose?: boolean;
}

function ts(): string {
  const d = new Date();
  return d.toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
}

export async function createLogger(
  sandboxName: string,
  opts: LoggerOptions = {},
): Promise<Logger> {
  const paths = homePaths();
  mkdirSync(paths.logsDir, { recursive: true });
  const path = paths.logFile(sandboxName, ts());
  const stream: WriteStream = createWriteStream(path, { flags: "a" });
  let phasePrefix = "";

  const write = (level: string, msg: string) => {
    const line = `${new Date().toISOString()} ${level} ${phasePrefix}${msg}\n`;
    stream.write(line);
    if (opts.verbose) process.stderr.write(line);
  };

  return {
    path,
    info: (m) => write("INFO", m),
    warn: (m) => write("WARN", m),
    error: (m) => write("ERR ", m),
    async phase(name, fn) {
      const start = Date.now();
      phasePrefix = "";
      write("INFO", `phase: ${name} starting`);
      phasePrefix = `[${name}] `;
      try {
        const result = await fn();
        phasePrefix = "";
        write("INFO", `phase: ${name} ok (${Date.now() - start}ms)`);
        return result;
      } catch (err) {
        phasePrefix = "";
        write(
          "ERR ",
          `phase: ${name} failed (${Date.now() - start}ms): ${(err as Error).message}`,
        );
        throw err;
      } finally {
        phasePrefix = "";
      }
    },
    async close() {
      await new Promise<void>((res) => stream.end(res));
    },
  };
}
