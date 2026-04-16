import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { CopyToWorkspaceTimeoutError, withTimeout } from "./errors.js";

const COPY_TO_WORKSPACE_TIMEOUT_MS = 60_000;

/**
 * Copy files and directories from the host repo root to the worktree root,
 * using `cp -R --reflink=auto` for copy-on-write when the filesystem supports it.
 * Missing paths are silently skipped.
 */
export const copyToWorkspace = (
  paths: string[],
  hostRepoDir: string,
  worktreePath: string,
): Effect.Effect<void, CopyToWorkspaceTimeoutError> =>
  Effect.gen(function* () {
    for (const relativePath of paths) {
      const src = join(hostRepoDir, relativePath);
      if (!existsSync(src)) {
        continue;
      }
      const dest = join(worktreePath, relativePath);
      yield* Effect.async<void, never>((resume) => {
        execFile("cp", ["-R", "--reflink=auto", src, dest], (error) => {
          if (error) {
            // Fall back to a regular copy if reflink is not supported
            execFile("cp", ["-R", src, dest], () => {
              resume(Effect.succeed(undefined));
            });
          } else {
            resume(Effect.succeed(undefined));
          }
        });
      });
    }
  }).pipe(
    withTimeout(
      COPY_TO_WORKSPACE_TIMEOUT_MS,
      () =>
        new CopyToWorkspaceTimeoutError({
          message: `Copying files to workspace timed out after ${COPY_TO_WORKSPACE_TIMEOUT_MS}ms`,
          timeoutMs: COPY_TO_WORKSPACE_TIMEOUT_MS,
          paths,
        }),
    ),
  );
