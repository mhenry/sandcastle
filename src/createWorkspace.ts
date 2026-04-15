import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import type { CloseResult } from "./createSandbox.js";
import type {
  MergeToHeadBranchStrategy,
  NamedBranchStrategy,
} from "./SandboxProvider.js";
import * as WorkspaceManager from "./WorkspaceManager.js";
import { copyToWorkspace } from "./CopyToWorkspace.js";

/** Branch strategies valid for createWorkspace — head is excluded. */
export type WorkspaceBranchStrategy =
  | MergeToHeadBranchStrategy
  | NamedBranchStrategy;

export interface CreateWorkspaceOptions {
  /** Branch strategy — only 'branch' and 'merge-to-head' are allowed. */
  readonly branchStrategy: WorkspaceBranchStrategy;
  /** Paths relative to the host repo root to copy into the workspace at creation time. */
  readonly copyToWorkspace?: string[];
  /** @internal Test-only overrides. */
  readonly _test?: {
    readonly hostRepoDir?: string;
  };
}

export interface Workspace {
  /** The branch the workspace is on. */
  readonly branch: string;
  /** Host path to the workspace (worktree). */
  readonly workspacePath: string;
  /** Clean up the workspace. Preserves worktree if dirty. */
  close(): Promise<CloseResult>;
  /** Auto cleanup via `await using`. */
  [Symbol.asyncDispose](): Promise<void>;
}

/**
 * Creates a git worktree as an independent, first-class workspace.
 * Returns a Workspace handle with close() and [Symbol.asyncDispose]().
 *
 * Only accepts 'branch' and 'merge-to-head' strategies — 'head' is a
 * compile-time type error since head means no worktree.
 */
export const createWorkspace = async (
  options: CreateWorkspaceOptions,
): Promise<Workspace> => {
  const hostRepoDir = options._test?.hostRepoDir ?? process.cwd();

  // Determine branch from strategy
  const branch =
    options.branchStrategy.type === "branch"
      ? options.branchStrategy.branch
      : undefined;

  // 1. Prune stale worktrees + create worktree
  const worktreeInfo = await Effect.runPromise(
    WorkspaceManager.pruneStale(hostRepoDir)
      .pipe(Effect.catchAll(() => Effect.void))
      .pipe(Effect.andThen(WorkspaceManager.create(hostRepoDir, { branch })))
      .pipe(Effect.provide(NodeContext.layer)),
  );

  const worktreePath = worktreeInfo.path;
  const resolvedBranch = worktreeInfo.branch;

  // 2. Copy files if requested
  if (options.copyToWorkspace && options.copyToWorkspace.length > 0) {
    await Effect.runPromise(
      copyToWorkspace(options.copyToWorkspace, hostRepoDir, worktreePath),
    );
  }

  // 3. Build close function
  let closed = false;

  const doClose = async (): Promise<CloseResult> => {
    if (closed) return { preservedWorkspacePath: undefined };
    closed = true;

    // Check for uncommitted changes
    const isDirty = await Effect.runPromise(
      WorkspaceManager.hasUncommittedChanges(worktreePath).pipe(
        Effect.catchAll(() => Effect.succeed(false)),
      ),
    );

    if (isDirty) {
      return { preservedWorkspacePath: worktreePath };
    }

    // Remove worktree
    await Effect.runPromise(
      WorkspaceManager.remove(worktreePath).pipe(
        Effect.catchAll(() => Effect.void),
      ),
    );

    return { preservedWorkspacePath: undefined };
  };

  // 4. Return Workspace handle
  const workspace: Workspace = {
    branch: resolvedBranch,
    workspacePath: worktreePath,

    close: async (): Promise<CloseResult> => doClose(),

    [Symbol.asyncDispose]: async (): Promise<void> => {
      await workspace.close();
    },
  };

  return workspace;
};
