import { AgentboxError } from "../../errors.ts";

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
      case "--name": {
        const val = args[i + 1];
        if (val === undefined || val.startsWith("--")) {
          throw new AgentboxError("--name requires a value", {
            fix: "agentbox up <path>.yaml --name <name>",
          });
        }
        name = val;
        i++;
        break;
      }
      case "--replace":
        replace = true;
        break;
      case "--keep":
        keep = true;
        break;
      case "--keep-on-error":
        keepOnError = true;
        break;
      case "--verbose":
      case "-v":
        verbose = true;
        break;
      default:
        if (a.startsWith("--"))
          throw new AgentboxError(`unknown flag: ${a}`, {
            fix: "Run `agentbox --help` for usage",
          });
        if (configPath !== undefined)
          throw new AgentboxError(`unexpected positional argument: ${a}`, {
            fix: "Only one positional config-path argument is accepted",
          });
        configPath = a;
    }
  }
  if (configPath === undefined)
    throw new AgentboxError("config path is required", {
      fix: "agentbox up <path>.yaml",
    });
  return { configPath, name, replace, keep, keepOnError, verbose };
}
