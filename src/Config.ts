import { Effect, Schema } from "effect";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const HookDefinition = Schema.Struct({
  command: Schema.String,
}).annotations({ title: "HookDefinition" });

const SandcastleConfigSchema = Schema.Struct({
  hooks: Schema.optional(
    Schema.Struct({
      onSandboxCreate: Schema.optional(Schema.Array(HookDefinition)),
      onSandboxReady: Schema.optional(Schema.Array(HookDefinition)),
    }),
  ),
  defaultIterations: Schema.optional(Schema.Number),
}).annotations({ title: "SandcastleConfig" });

export type HookDefinition = typeof HookDefinition.Type;
export type SandcastleConfig = typeof SandcastleConfigSchema.Type;

export class ConfigError extends Error {
  readonly _tag = "ConfigError";
  constructor(message: string) {
    super(message);
  }
}

const decodeConfig = Schema.decodeUnknownEither(SandcastleConfigSchema, {
  onExcessProperty: "error",
});

export const readConfig = (
  repoDir: string,
): Effect.Effect<SandcastleConfig, ConfigError> =>
  Effect.gen(function* () {
    const content = yield* Effect.promise(() =>
      readFile(join(repoDir, ".sandcastle", "config.json"), "utf-8").catch(
        () => null,
      ),
    );
    if (content === null) return {} as SandcastleConfig;

    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      return yield* Effect.fail(new ConfigError("Invalid JSON in config.json"));
    }

    const result = decodeConfig(raw);
    if (result._tag === "Left") {
      return yield* Effect.fail(new ConfigError(result.left.message));
    }

    return result.right;
  });
