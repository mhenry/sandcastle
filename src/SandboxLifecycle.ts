import { Effect } from "effect";
import type { SandcastleConfig } from "./Config.js";
import { Sandbox, SandboxError, type SandboxService } from "./Sandbox.js";
import { execOk, runHooks, syncIn, syncOut } from "./SyncService.js";

export interface SandboxLifecycleOptions {
  readonly hostRepoDir: string;
  readonly sandboxRepoDir: string;
  readonly hooks?: SandcastleConfig["hooks"];
}

export interface SandboxContext {
  readonly sandbox: SandboxService;
  readonly sandboxRepoDir: string;
  readonly baseHead: string;
}

export const withSandboxLifecycle = <A>(
  options: SandboxLifecycleOptions,
  work: (ctx: SandboxContext) => Effect.Effect<A, SandboxError, Sandbox>,
): Effect.Effect<A, SandboxError, Sandbox> =>
  Effect.gen(function* () {
    const sandbox = yield* Sandbox;
    const { hostRepoDir, sandboxRepoDir, hooks } = options;

    // Run onSandboxCreate hooks (before sync-in)
    yield* runHooks(hooks?.onSandboxCreate);

    // Sync-in
    yield* syncIn(hostRepoDir, sandboxRepoDir);

    // Run onSandboxReady hooks (after sync-in)
    yield* runHooks(hooks?.onSandboxReady, { cwd: sandboxRepoDir });

    // Record base HEAD
    const baseHead = (yield* execOk(sandbox, "git rev-parse HEAD", {
      cwd: sandboxRepoDir,
    })).stdout.trim();

    // Run the caller's work
    const result = yield* work({ sandbox, sandboxRepoDir, baseHead });

    // Sync-out
    yield* syncOut(hostRepoDir, sandboxRepoDir, baseHead);

    return result;
  });
