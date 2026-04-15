import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createWorkspace } from "./createWorkspace.js";
import type { CreateWorkspaceOptions } from "./createWorkspace.js";

const execAsync = promisify(exec);

const initRepo = async (dir: string) => {
  await execAsync("git init -b main", { cwd: dir });
  await execAsync('git config user.email "test@test.com"', { cwd: dir });
  await execAsync('git config user.name "Test"', { cwd: dir });
};

const commitFile = async (
  dir: string,
  name: string,
  content: string,
  message: string,
) => {
  await writeFile(join(dir, name), content);
  await execAsync(`git add "${name}"`, { cwd: dir });
  await execAsync(`git commit -m "${message}"`, { cwd: dir });
};

describe("createWorkspace", () => {
  it("creates a workspace with 'branch' strategy", async () => {
    const hostDir = await mkdtemp(join(tmpdir(), "ws-test-"));
    await initRepo(hostDir);
    await commitFile(hostDir, "init.txt", "init", "initial commit");

    const ws = await createWorkspace({
      branchStrategy: { type: "branch", branch: "test-branch" },
      _test: { hostRepoDir: hostDir },
    });

    try {
      expect(ws.workspacePath).toContain(".sandcastle/worktrees");
      expect(ws.branch).toBe("test-branch");
      expect(existsSync(ws.workspacePath)).toBe(true);
    } finally {
      await ws.close();
      await rm(hostDir, { recursive: true, force: true });
    }
  });

  it("creates a workspace with 'merge-to-head' strategy", async () => {
    const hostDir = await mkdtemp(join(tmpdir(), "ws-test-"));
    await initRepo(hostDir);
    await commitFile(hostDir, "init.txt", "init", "initial commit");

    const ws = await createWorkspace({
      branchStrategy: { type: "merge-to-head" },
      _test: { hostRepoDir: hostDir },
    });

    try {
      expect(ws.workspacePath).toContain(".sandcastle/worktrees");
      expect(ws.branch).toMatch(/^sandcastle\//);
      expect(existsSync(ws.workspacePath)).toBe(true);
    } finally {
      await ws.close();
      await rm(hostDir, { recursive: true, force: true });
    }
  });

  it("rejects 'head' branch strategy at the type level", () => {
    // @ts-expect-error - head strategy should be a compile-time error
    const _options: CreateWorkspaceOptions = {
      branchStrategy: { type: "head" },
    };
  });

  it("copies files into the workspace with copyToWorkspace", async () => {
    const hostDir = await mkdtemp(join(tmpdir(), "ws-test-"));
    await initRepo(hostDir);
    await commitFile(hostDir, "init.txt", "init", "initial commit");

    // Create a file to copy
    await writeFile(join(hostDir, "node_modules.txt"), "deps");

    const ws = await createWorkspace({
      branchStrategy: { type: "branch", branch: "copy-test" },
      copyToWorkspace: ["node_modules.txt"],
      _test: { hostRepoDir: hostDir },
    });

    try {
      expect(existsSync(join(ws.workspacePath, "node_modules.txt"))).toBe(true);
    } finally {
      await ws.close();
      await rm(hostDir, { recursive: true, force: true });
    }
  });

  it("close() removes worktree when clean", async () => {
    const hostDir = await mkdtemp(join(tmpdir(), "ws-test-"));
    await initRepo(hostDir);
    await commitFile(hostDir, "init.txt", "init", "initial commit");

    const ws = await createWorkspace({
      branchStrategy: { type: "branch", branch: "clean-close" },
      _test: { hostRepoDir: hostDir },
    });

    const worktreePath = ws.workspacePath;
    const result = await ws.close();

    expect(result.preservedWorkspacePath).toBeUndefined();
    expect(existsSync(worktreePath)).toBe(false);
    await rm(hostDir, { recursive: true, force: true });
  });

  it("close() preserves worktree when dirty", async () => {
    const hostDir = await mkdtemp(join(tmpdir(), "ws-test-"));
    await initRepo(hostDir);
    await commitFile(hostDir, "init.txt", "init", "initial commit");

    const ws = await createWorkspace({
      branchStrategy: { type: "branch", branch: "dirty-close" },
      _test: { hostRepoDir: hostDir },
    });

    // Make workspace dirty
    await writeFile(join(ws.workspacePath, "dirty.txt"), "uncommitted");

    const result = await ws.close();

    expect(result.preservedWorkspacePath).toBe(ws.workspacePath);
    expect(existsSync(ws.workspacePath)).toBe(true);

    // Clean up manually
    await rm(ws.workspacePath, { recursive: true, force: true });
    await execAsync("git worktree prune", { cwd: hostDir });
    await rm(hostDir, { recursive: true, force: true });
  });

  it("Symbol.asyncDispose works via await using", async () => {
    const hostDir = await mkdtemp(join(tmpdir(), "ws-test-"));
    await initRepo(hostDir);
    await commitFile(hostDir, "init.txt", "init", "initial commit");

    let worktreePath: string;
    {
      await using ws = await createWorkspace({
        branchStrategy: { type: "branch", branch: "dispose-test" },
        _test: { hostRepoDir: hostDir },
      });
      worktreePath = ws.workspacePath;
      expect(existsSync(worktreePath)).toBe(true);
    }
    expect(existsSync(worktreePath!)).toBe(false);
    await rm(hostDir, { recursive: true, force: true });
  });

  it("close() is idempotent", async () => {
    const hostDir = await mkdtemp(join(tmpdir(), "ws-test-"));
    await initRepo(hostDir);
    await commitFile(hostDir, "init.txt", "init", "initial commit");

    const ws = await createWorkspace({
      branchStrategy: { type: "branch", branch: "idempotent-close" },
      _test: { hostRepoDir: hostDir },
    });

    const result1 = await ws.close();
    const result2 = await ws.close();

    expect(result1.preservedWorkspacePath).toBeUndefined();
    expect(result2.preservedWorkspacePath).toBeUndefined();
    await rm(hostDir, { recursive: true, force: true });
  });
});
