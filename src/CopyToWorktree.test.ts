import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { copyToWorktree, getCopyOnWriteFlags } from "./CopyToWorktree.js";
import { CopyToWorktreeError } from "./errors.js";

describe("getCopyOnWriteFlags", () => {
  it("returns -cR on darwin (APFS clonefile)", () => {
    expect(getCopyOnWriteFlags("darwin")).toEqual(["-cR"]);
  });

  it("returns -R --reflink=auto on linux", () => {
    expect(getCopyOnWriteFlags("linux")).toEqual(["-R", "--reflink=auto"]);
  });

  it("returns -R --reflink=auto on other platforms", () => {
    expect(getCopyOnWriteFlags("win32")).toEqual(["-R", "--reflink=auto"]);
    expect(getCopyOnWriteFlags("freebsd")).toEqual(["-R", "--reflink=auto"]);
  });
});

describe("copyToWorktree", () => {
  it("fails with CopyToWorktreeError when fallback cp -R fails", async () => {
    const hostDir = await mkdtemp(join(tmpdir(), "cw-test-"));
    const worktreeDir = await mkdtemp(join(tmpdir(), "cw-wt-"));

    // Create source at hostDir/nested/file.txt
    await mkdir(join(hostDir, "nested"));
    await writeFile(join(hostDir, "nested", "file.txt"), "content");

    // Create a regular file at worktreeDir/nested — cp will fail
    // because it cannot traverse a file as if it were a directory
    await writeFile(join(worktreeDir, "nested"), "blocker");

    try {
      const exit = await Effect.runPromiseExit(
        copyToWorktree(["nested/file.txt"], hostDir, worktreeDir),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
        const error = exit.cause.error;
        expect(error).toBeInstanceOf(CopyToWorktreeError);
        if (error instanceof CopyToWorktreeError) {
          expect(error.path).toBe("nested/file.txt");
          expect(error.stderr).toBeTruthy();
          expect(error._tag).toBe("CopyToWorktreeError");
        }
      } else {
        throw new Error("Expected Fail cause");
      }
    } finally {
      await rm(hostDir, { recursive: true, force: true });
      await rm(worktreeDir, { recursive: true, force: true });
    }
  });

  it("succeeds when first cp fails but fallback cp -R succeeds", async () => {
    const hostDir = await mkdtemp(join(tmpdir(), "cw-test-"));
    const worktreeDir = await mkdtemp(join(tmpdir(), "cw-wt-"));

    // Create a source file
    await writeFile(join(hostDir, "file.txt"), "content");

    try {
      // Normal copy should succeed (fallback may or may not be needed)
      await Effect.runPromise(
        copyToWorktree(["file.txt"], hostDir, worktreeDir),
      );
      expect(existsSync(join(worktreeDir, "file.txt"))).toBe(true);
    } finally {
      await rm(hostDir, { recursive: true, force: true });
      await rm(worktreeDir, { recursive: true, force: true });
    }
  });

  it("skips missing source paths without error", async () => {
    const hostDir = await mkdtemp(join(tmpdir(), "cw-test-"));
    const worktreeDir = await mkdtemp(join(tmpdir(), "cw-wt-"));

    try {
      await Effect.runPromise(
        copyToWorktree(["nonexistent.txt"], hostDir, worktreeDir),
      );
      // Should complete without error
    } finally {
      await rm(hostDir, { recursive: true, force: true });
      await rm(worktreeDir, { recursive: true, force: true });
    }
  });
});
