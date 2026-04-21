/**
 * SessionStore — keyed collection of agent session JSONLs.
 *
 * Provides read/write access to Claude Code session files, with two
 * implementations: host-backed (filesystem) and sandbox-backed (via
 * bind-mount handle file-transfer primitives). The `transferSession`
 * function copies a session between stores, rewriting `cwd` fields in
 * the JSONL entries from source cwd to target cwd.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BindMountSandboxHandle } from "./SandboxProvider.js";

// ---------------------------------------------------------------------------
// SessionStore interface
// ---------------------------------------------------------------------------

/** A keyed collection of agent session JSONLs associated with a cwd. */
export interface SessionStore {
  /** The working directory this store is associated with. */
  readonly cwd: string;
  /** Read a session's JSONL content by ID. Throws if not found. */
  readSession(id: string): Promise<string>;
  /** Write a session's JSONL content by ID. Creates or overwrites. */
  writeSession(id: string, content: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Path encoding
// ---------------------------------------------------------------------------

/**
 * Encode a cwd into the Claude Code `~/.claude/projects/<encoded>/` layout.
 * Replaces path separators with hyphens, matching Claude Code's convention.
 */
export const encodeProjectPath = (cwd: string): string => {
  // Strip trailing slash (but preserve root "/")
  const normalized = cwd.length > 1 ? cwd.replace(/\/+$/, "") : cwd;
  return normalized.replaceAll("/", "-");
};

// ---------------------------------------------------------------------------
// Host-backed SessionStore
// ---------------------------------------------------------------------------

/**
 * Create a host-backed SessionStore that reads/writes session JSONLs on the
 * host filesystem using Claude Code's `~/.claude/projects/<encoded>/sessions/`
 * layout.
 *
 * @param cwd - The host repo directory this store is associated with.
 * @param projectsDir - Override for the projects directory (default: `~/.claude/projects`).
 */
export const hostSessionStore = (
  cwd: string,
  projectsDir?: string,
): SessionStore => {
  const baseDir =
    projectsDir ?? join(process.env.HOME ?? "~", ".claude", "projects");
  const encoded = encodeProjectPath(cwd);
  const sessionsDir = join(baseDir, encoded, "sessions");

  return {
    cwd,
    readSession: async (id: string): Promise<string> => {
      return await readFile(join(sessionsDir, `${id}.jsonl`), "utf-8");
    },
    writeSession: async (id: string, content: string): Promise<void> => {
      await mkdir(sessionsDir, { recursive: true });
      await writeFile(join(sessionsDir, `${id}.jsonl`), content);
    },
  };
};

// ---------------------------------------------------------------------------
// Sandbox-backed SessionStore
// ---------------------------------------------------------------------------

/**
 * Create a sandbox-backed SessionStore that uses a bind-mount handle's
 * `copyFileIn`/`copyFileOut` to transfer session files.
 *
 * @param cwd - The sandbox-side working directory.
 * @param handle - The bind-mount sandbox handle for file transfer.
 * @param projectsDir - The sandbox-side path to `~/.claude/projects`.
 */
export const sandboxSessionStore = (
  cwd: string,
  handle: Pick<BindMountSandboxHandle, "copyFileIn" | "copyFileOut">,
  projectsDir: string,
): SessionStore => {
  const encoded = encodeProjectPath(cwd);
  const sessionsDir = join(projectsDir, encoded, "sessions");

  return {
    cwd,
    readSession: async (id: string): Promise<string> => {
      const sandboxPath = join(sessionsDir, `${id}.jsonl`);
      // Copy to a temp file on the host, then read
      const tmpPath = join(
        dirname(sandboxPath),
        `.${id}.jsonl.tmp.${Date.now()}`,
      );
      await handle.copyFileOut(sandboxPath, tmpPath);
      const content = await readFile(tmpPath, "utf-8");
      return content;
    },
    writeSession: async (id: string, content: string): Promise<void> => {
      const sandboxPath = join(sessionsDir, `${id}.jsonl`);
      // Write to a temp file on the host, then copy into sandbox
      const tmpPath = join(
        dirname(sandboxPath),
        `.${id}.jsonl.tmp.${Date.now()}`,
      );
      await mkdir(dirname(tmpPath), { recursive: true });
      await writeFile(tmpPath, content);
      await handle.copyFileIn(tmpPath, sandboxPath);
    },
  };
};

// ---------------------------------------------------------------------------
// transferSession
// ---------------------------------------------------------------------------

/**
 * Transfer a session from one store to another, rewriting `cwd` fields in
 * the JSONL entries from the source store's cwd to the target store's cwd.
 */
export const transferSession = async (
  from: SessionStore,
  to: SessionStore,
  id: string,
): Promise<void> => {
  const content = await from.readSession(id);

  if (content === "") {
    await to.writeSession(id, "");
    return;
  }

  const rewritten = content
    .split("\n")
    .map((line) => {
      if (line === "") return line;
      const entry = JSON.parse(line) as Record<string, unknown>;
      if (typeof entry.cwd === "string" && entry.cwd === from.cwd) {
        entry.cwd = to.cwd;
      }
      return JSON.stringify(entry);
    })
    .join("\n");

  await to.writeSession(id, rewritten);
};
