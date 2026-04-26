export interface UpFlags {
  configPath: string;
  name?: string;
  replace: boolean;
  keep: boolean;
  keepOnError: boolean;
  verbose: boolean;
}

export function parseUpFlags(args: string[]): UpFlags {
  let configPath: string | undefined;
  let name: string | undefined;
  let replace = false;
  let keep = false;
  let keepOnError = false;
  let verbose = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    switch (a) {
      case "--name": name = args[++i]; break;
      case "--replace": replace = true; break;
      case "--keep": keep = true; break;
      case "--keep-on-error": keepOnError = true; break;
      case "--verbose":
      case "-v":
        verbose = true; break;
      default:
        if (a.startsWith("--")) throw new Error(`unknown flag: ${a}`);
        if (configPath !== undefined) throw new Error(`unexpected positional argument: ${a}`);
        configPath = a;
    }
  }
  if (configPath === undefined) throw new Error("config path is required");
  return { configPath, name, replace, keep, keepOnError, verbose };
}
