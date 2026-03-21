import { Console, Effect } from "effect";
import type { SandcastleConfig } from "./Config.js";
import { Sandbox, SandboxError, type SandboxService } from "./Sandbox.js";
import { SandboxFactory } from "./SandboxFactory.js";
import { withSandboxLifecycle } from "./SandboxLifecycle.js";

const fetchIssues = (
  sandbox: SandboxService,
  sandboxRepoDir: string,
  repoFullName: string,
): Effect.Effect<string, SandboxError> =>
  Effect.map(
    sandbox.exec(
      `gh issue list --repo "${repoFullName}" --state open --json number,title,body,comments`,
      { cwd: sandboxRepoDir },
    ),
    (result) => (result.exitCode === 0 ? result.stdout.trim() : "[]"),
  );

const fetchRalphCommits = (
  sandbox: SandboxService,
  sandboxRepoDir: string,
): Effect.Effect<string, SandboxError> =>
  Effect.map(
    sandbox.exec(
      'git log --grep="RALPH" -n 10 --format="%H%n%ad%n%B---" --date=short',
      { cwd: sandboxRepoDir },
    ),
    (result) =>
      result.exitCode === 0 && result.stdout.trim().length > 0
        ? result.stdout.trim()
        : "No RALPH commits found",
  );

/** Extract displayable text from a stream-json line */
export const parseStreamJsonLine = (
  line: string,
):
  | { type: "text"; text: string }
  | { type: "result"; result: string }
  | null => {
  if (!line.startsWith("{")) return null;
  try {
    const obj = JSON.parse(line);
    if (obj.type === "assistant" && Array.isArray(obj.message?.content)) {
      const texts = obj.message.content
        .filter((c: { type: string }) => c.type === "text")
        .map((c: { text: string }) => c.text);
      if (texts.length > 0) return { type: "text", text: texts.join("") };
    }
    if (obj.type === "result" && typeof obj.result === "string") {
      return { type: "result", result: obj.result };
    }
  } catch {
    // Not valid JSON — skip
  }
  return null;
};

const invokeAgent = (
  sandbox: SandboxService,
  sandboxRepoDir: string,
  prompt: string,
): Effect.Effect<string, SandboxError> =>
  Effect.gen(function* () {
    let resultText = "";

    const execResult = yield* sandbox.execStreaming(
      `claude --print --verbose --dangerously-skip-permissions --output-format stream-json --model claude-opus-4-6 -p ${shellEscape(prompt)}`,
      (line) => {
        const parsed = parseStreamJsonLine(line);
        if (parsed?.type === "text") {
          console.log(parsed.text);
        } else if (parsed?.type === "result") {
          resultText = parsed.result;
        }
      },
      { cwd: sandboxRepoDir },
    );

    if (execResult.exitCode !== 0) {
      return yield* Effect.fail(
        new SandboxError(
          "invokeAgent",
          `Claude exited with code ${execResult.exitCode}:\n${execResult.stderr}`,
        ),
      );
    }

    return resultText || execResult.stdout;
  });

const shellEscape = (s: string): string => "'" + s.replace(/'/g, "'\\''") + "'";

const COMPLETION_SIGNAL = "<promise>COMPLETE</promise>";

export interface OrchestrateOptions {
  readonly hostRepoDir: string;
  readonly sandboxRepoDir: string;
  readonly iterations: number;
  readonly config?: SandcastleConfig;
  readonly repoFullName: string;
  readonly prompt: string;
}

export interface OrchestrateResult {
  readonly iterationsRun: number;
  readonly complete: boolean;
}

export const orchestrate = (
  options: OrchestrateOptions,
): Effect.Effect<OrchestrateResult, SandboxError, SandboxFactory> =>
  Effect.gen(function* () {
    const factory = yield* SandboxFactory;
    const {
      hostRepoDir,
      sandboxRepoDir,
      iterations,
      config,
      repoFullName,
      prompt,
    } = options;

    for (let i = 1; i <= iterations; i++) {
      yield* Console.log(`\n=== Iteration ${i}/${iterations} ===\n`);

      const iterationResult = yield* factory.withSandbox(
        withSandboxLifecycle(
          { hostRepoDir, sandboxRepoDir, hooks: config?.hooks },
          (ctx) =>
            Effect.gen(function* () {
              // Fetch context
              const issues = yield* fetchIssues(
                ctx.sandbox,
                ctx.sandboxRepoDir,
                repoFullName,
              );
              const ralphCommits = yield* fetchRalphCommits(
                ctx.sandbox,
                ctx.sandboxRepoDir,
              );

              // Build full prompt with context
              const fullPrompt = `ISSUES: ${issues}\n\nPrevious RALPH commits: ${ralphCommits}\n\n${prompt}`;

              // Invoke the agent
              yield* Console.log("Running agent...");
              const agentOutput = yield* invokeAgent(
                ctx.sandbox,
                ctx.sandboxRepoDir,
                fullPrompt,
              );

              // Check completion signal
              if (agentOutput.includes(COMPLETION_SIGNAL)) {
                return { complete: true } as const;
              }
              return { complete: false } as const;
            }),
        ),
      );

      if (iterationResult.complete) {
        yield* Console.log(
          `\nAgent signaled completion after ${i} iteration(s).`,
        );
        return { iterationsRun: i, complete: true };
      }
    }

    yield* Console.log(`\nCompleted ${iterations} iteration(s).`);
    return { iterationsRun: iterations, complete: false };
  });
