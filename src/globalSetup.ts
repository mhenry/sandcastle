import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmpDir: string;

export function setup() {
  tmpDir = mkdtempSync(join(tmpdir(), "test-gitconfig-global-"));
  const globalConfigPath = join(tmpDir, ".gitconfig");
  writeFileSync(globalConfigPath, "");
  process.env.GIT_CONFIG_GLOBAL = globalConfigPath;
}

export function teardown() {
  delete process.env.GIT_CONFIG_GLOBAL;
  try {
    rmSync(tmpDir, { recursive: true });
  } catch {}
}
