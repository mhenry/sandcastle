import { Cause, Effect, Exit } from "effect";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, readConfig } from "./Config.js";

const setupConfigDir = async (
  repoDir: string,
  config: Record<string, unknown>,
) => {
  const configDir = join(repoDir, ".sandcastle");
  await mkdir(configDir, { recursive: true });
  await writeFile(join(configDir, "config.json"), JSON.stringify(config));
};

const expectConfigError = (exit: Exit.Exit<unknown, unknown>): string => {
  expect(exit._tag).toBe("Failure");
  if (exit._tag !== "Failure") throw new Error("unreachable");
  const error = Cause.failureOption(exit.cause);
  expect(error._tag).toBe("Some");
  if (error._tag !== "Some") throw new Error("unreachable");
  expect(error.value).toBeInstanceOf(ConfigError);
  return (error.value as ConfigError).message;
};

describe("readConfig", () => {
  it("reads defaultIterations from config", async () => {
    const repoDir = await mkdtemp(join(tmpdir(), "config-test-"));
    await setupConfigDir(repoDir, { defaultIterations: 10 });

    const config = await Effect.runPromise(readConfig(repoDir));
    expect(config.defaultIterations).toBe(10);
  });

  it("returns undefined for defaultIterations when not set", async () => {
    const repoDir = await mkdtemp(join(tmpdir(), "config-test-"));
    await setupConfigDir(repoDir, {});

    const config = await Effect.runPromise(readConfig(repoDir));
    expect(config.defaultIterations).toBeUndefined();
  });

  it("returns empty config when file does not exist", async () => {
    const repoDir = await mkdtemp(join(tmpdir(), "config-test-"));

    const config = await Effect.runPromise(readConfig(repoDir));
    expect(config.defaultIterations).toBeUndefined();
  });

  it("throws ConfigError on unknown top-level key", async () => {
    const repoDir = await mkdtemp(join(tmpdir(), "config-test-"));
    await setupConfigDir(repoDir, { postSyncIn: "npm install" });

    const exit = await Effect.runPromiseExit(readConfig(repoDir));
    const message = expectConfigError(exit);
    expect(message).toContain("unexpected");
    expect(message).toContain("postSyncIn");
  });

  it("throws ConfigError on unknown hook name", async () => {
    const repoDir = await mkdtemp(join(tmpdir(), "config-test-"));
    await setupConfigDir(repoDir, {
      hooks: { onBeforeRun: [{ command: "echo hi" }] },
    });

    const exit = await Effect.runPromiseExit(readConfig(repoDir));
    const message = expectConfigError(exit);
    expect(message).toContain("unexpected");
    expect(message).toContain("onBeforeRun");
  });

  it("throws ConfigError on unknown key in hook definition", async () => {
    const repoDir = await mkdtemp(join(tmpdir(), "config-test-"));
    await setupConfigDir(repoDir, {
      hooks: { onSandboxReady: [{ command: "echo hi", timeout: 5000 }] },
    });

    const exit = await Effect.runPromiseExit(readConfig(repoDir));
    const message = expectConfigError(exit);
    expect(message).toContain("unexpected");
    expect(message).toContain("timeout");
  });

  it("accepts valid hooks config", async () => {
    const repoDir = await mkdtemp(join(tmpdir(), "config-test-"));
    await setupConfigDir(repoDir, {
      hooks: {
        onSandboxCreate: [{ command: "apt-get update" }],
        onSandboxReady: [{ command: "npm install" }],
      },
      defaultIterations: 3,
    });

    const config = await Effect.runPromise(readConfig(repoDir));
    expect(config.hooks?.onSandboxCreate?.[0]?.command).toBe("apt-get update");
    expect(config.hooks?.onSandboxReady?.[0]?.command).toBe("npm install");
    expect(config.defaultIterations).toBe(3);
  });
});
