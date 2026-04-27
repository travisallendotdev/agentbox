import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

function homeDir(): string {
  const h = process.env.HOME;
  if (!h) throw new Error("HOME environment variable not set");
  return h;
}

/**
 * Strip every `[credential ...]` section from a gitconfig source. These
 * sections reference host-side helpers (osxkeychain, gh) and tokens that are
 * useless or outright harmful inside a sandbox VM.
 */
function scrubCredentialSections(text: string): string {
  const out: string[] = [];
  let inCredential = false;
  for (const line of text.split("\n")) {
    const sectionMatch = line.match(/^\s*\[([^\]\s]+)/);
    if (sectionMatch) {
      inCredential = sectionMatch[1]!.toLowerCase() === "credential";
      if (inCredential) continue;
    }
    if (!inCredential) out.push(line);
  }
  return out.join("\n");
}

/**
 * Build the gitconfig that gets staged at home/agent/.gitconfig.
 *
 * Starts from the host's `~/.gitconfig` (so user.name/email/aliases come
 * along), drops `[credential]` sections, and appends `[safe] directory = *`
 * so git tolerates the bind-mounted .git dirs whose ownership doesn't match
 * the in-VM agent user.
 */
export function buildSandboxGitconfig(): string {
  const path = join(homeDir(), ".gitconfig");
  let body = "";
  if (existsSync(path)) {
    try {
      body = scrubCredentialSections(readFileSync(path, "utf8"));
    } catch {
      body = "";
    }
  }
  const trimmed = body.replace(/\s+$/, "");
  const safe = "[safe]\n\tdirectory = *\n";
  return trimmed ? `${trimmed}\n\n${safe}` : safe;
}
