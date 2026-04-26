import { existsSync, statSync } from "node:fs";
import { join, isAbsolute } from "node:path";

export async function resolvePrompt(value: string | undefined): Promise<string | undefined> {
  if (value === undefined) return undefined;
  let candidate = value;
  if (candidate.startsWith("~/")) candidate = join(process.env.HOME!, candidate.slice(2));
  if (!isAbsolute(candidate)) candidate = join(process.cwd(), candidate);
  if (existsSync(candidate) && statSync(candidate).isFile()) {
    return await Bun.file(candidate).text();
  }
  return value;
}
