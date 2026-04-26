import { z } from "zod";

const HookEntry = z.object({
  matcher: z.string(),
  command: z.string(),
});

const Hooks = z.object({
  PreToolUse: z.array(HookEntry).optional(),
  PostToolUse: z.array(HookEntry).optional(),
  Stop: z.array(HookEntry).optional(),
  UserPromptSubmit: z.array(HookEntry).optional(),
  SessionStart: z.array(HookEntry).optional(),
}).strict();

const RepoLocal = z.object({
  source: z.literal("local"),
  path: z.string(),
  branch: z.string().optional(),
}).strict();

const RepoGit = z.object({
  source: z.literal("git"),
  url: z.string(),
  branch: z.string().optional(),
  place: z.enum(["workspace", "vm"]).optional(),
}).strict();

const Repo = z.discriminatedUnion("source", [RepoLocal, RepoGit]);

const Lifecycle = z.object({
  post_create: z.array(z.string()).optional(),
  pre_agent: z.array(z.string()).optional(),
  on_stop: z.array(z.string()).optional(),
}).strict();

const Network = z.object({
  allow: z.array(z.string()).optional(),
}).strict();

export const AgentboxConfigSchema = z.object({
  name: z.string().optional(),
  mode: z.enum(["durable", "ephemeral"]),
  base_template: z.string().optional(),
  repos: z.array(Repo).optional(),
  skills: z.array(z.string()).optional(),
  hooks: Hooks.optional(),
  lifecycle: Lifecycle.optional(),
  network: Network.optional(),
  env: z.record(z.string(), z.string()).optional(),
  secrets: z.array(z.string()).optional(),
  prompt: z.string().optional(),
}).strict();

export type AgentboxConfig = z.infer<typeof AgentboxConfigSchema>;
export type RepoLocal = z.infer<typeof RepoLocal>;
export type RepoGit = z.infer<typeof RepoGit>;
export type Repo = z.infer<typeof Repo>;
export type HookConfig = z.infer<typeof Hooks>;
export type LifecycleConfig = z.infer<typeof Lifecycle>;
