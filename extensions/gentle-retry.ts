import type { AgentBeforeSettleEvent, ExtensionAPI, TurnEndEvent } from "@earendil-works/pi-coding-agent";
import { gentlePiConfigHome } from "../lib/agent-home.ts";
import { classifyTransientFailure, TRANSIENT_FAILURE_LABEL } from "../lib/retry-classification.ts";
import { resolveRetryPolicy, writeRetryPolicy } from "../lib/retry-policy.ts";

// The retry policy is Gentle Shell's own opt-in: when it is on, a transient
// provider failure (HTTP 429 or a timeout) never ends the run. Pi owns the
// request machinery and its own bounded retry group; this extension adds the
// unbounded continuation at Pi's settlement boundary, exactly where Pi itself
// continues after a recovery attempt.
//
// Two boundaries are used on purpose:
//   - `turn_end` runs inside the live agent run, so the growing spacing
//     between attempts can be interrupted by Escape through the run's abort
//     signal.
//   - `agent_before_settle` is the only boundary that can ask Pi for one more
//     provider request. It omits the failed attempt from the model context
//     (a `context_edit` with `replacement: null`), which is what makes the
//     continuation legal: the projection's last role stops being "assistant",
//     so Pi still has runnable model context to continue from.

export interface GentleRetryOptions {
	/** Override the Gentle config home (tests and isolated runs). */
	gentlePiConfigHome?: string;
	/** Replace the wait between attempts (tests). */
	sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

interface FailedAttempt {
	entryId: string;
	errorMessage?: string;
}

/** The failed assistant attempt must be the last projected message to be recoverable. */
function lastFailedAttempt(event: AgentBeforeSettleEvent): FailedAttempt | undefined {
	const entries = event.context.contextEntries;
	for (let index = entries.length - 1; index >= 0; index--) {
		const source = entries[index]!.sourceEntry;
		if (source.type !== "message") continue;
		const message = source.message;
		if (message.role !== "assistant" || message.stopReason !== "error") return undefined;
		return { entryId: source.id, errorMessage: message.errorMessage };
	}
	return undefined;
}

/** Exponential spacing between attempts, capped by the policy's ceiling. */
export function retrySpacingMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
	if (baseDelayMs <= 0 || attempt <= 1) return Math.max(0, Math.min(baseDelayMs, maxDelayMs));
	return Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
	if (ms <= 0) return Promise.resolve();
	return new Promise((resolve) => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const finish = () => {
			if (timer !== undefined) clearTimeout(timer);
			signal?.removeEventListener("abort", finish);
			resolve();
		};
		timer = setTimeout(finish, ms);
		if (signal?.aborted) {
			finish();
			return;
		}
		signal?.addEventListener("abort", finish, { once: true });
	});
}

function shellSwitchedOff(env: NodeJS.ProcessEnv): boolean {
	const value = env.GENTLE_SHELL?.trim().toLowerCase();
	return value === "0" || value === "false" || value === "off";
}

export default function gentleRetry(pi: ExtensionAPI, env: NodeJS.ProcessEnv = process.env, options: GentleRetryOptions = {}): void {
	if (shellSwitchedOff(env)) return;
	const configHome = options.gentlePiConfigHome ?? gentlePiConfigHome(env);
	const sleep = options.sleep ?? defaultSleep;
	// Consecutive transient failures in this session; reset by the first
	// successful turn so a later episode starts from the base spacing again.
	let attempts = 0;

	const resolvePolicy = (cwd: string) => resolveRetryPolicy({ gentlePiConfigHome: configHome, cwd });

	pi.on("turn_end", async (event: TurnEndEvent, ctx) => {
		const policy = resolvePolicy(ctx.cwd);
		if (policy.policy !== "on") return undefined;
		if (event.outcome !== "error") {
			attempts = 0;
			return undefined;
		}
		const kind = classifyTransientFailure(event.message.role === "assistant" ? event.message.errorMessage : undefined);
		if (!kind) return undefined;
		attempts += 1;
		await sleep(retrySpacingMs(attempts, policy.baseDelayMs, policy.maxDelayMs), ctx.signal);
		return undefined;
	});

	pi.on("agent_before_settle", async (event: AgentBeforeSettleEvent, ctx) => {
		const policy = resolvePolicy(ctx.cwd);
		if (policy.policy !== "on") return undefined;
		if (event.outcome !== "error") {
			attempts = 0;
			return undefined;
		}
		const failed = lastFailedAttempt(event);
		if (!failed) return undefined;
		const kind = classifyTransientFailure(failed.errorMessage);
		if (!kind) return undefined;
		ctx.ui.notify(
			`Gentle Shell: ${TRANSIENT_FAILURE_LABEL[kind]} — retrying (attempt ${Math.max(attempts, 1)}). Press Esc to stop.`,
			"warning",
		);
		return {
			entries: [...event.entries, { type: "context_edit", targetId: failed.entryId, replacement: null }],
			continue: true,
		};
	});

	pi.registerCommand("gentle:retry", {
		description: "Show or set the unlimited retry policy for HTTP 429 and timeout failures (status|enable|disable); no argument opens a menu.",
		handler: async (args, ctx) => {
			let action = args.trim() || "status";
			if (!args.trim() && ctx.hasUI && typeof ctx.ui.select === "function") {
				const selected = await ctx.ui.select(`Gentle retry (current: ${resolvePolicy(ctx.cwd).policy})`, ["enable", "disable", "status"]);
				if (selected === undefined) return;
				action = selected;
			}
			if (action !== "status" && action !== "enable" && action !== "disable") {
				ctx.ui.notify("Use /gentle:retry status|enable|disable.", "warning");
				return;
			}
			try {
				if (action !== "status") writeRetryPolicy(action === "enable" ? "on" : "off", { gentlePiConfigHome: configHome });
				const result = resolvePolicy(ctx.cwd);
				const source = result.source === "default" ? "built-in default" : result.source === "project_file" ? `project file ${result.projectFile}` : `global file ${result.globalFile}`;
				const projectNote = result.source === "project_file" && action !== "status" ? " The project file still decides this project." : "";
				const behavior = result.policy === "on"
					? "HTTP 429 and timeout failures are retried until the model answers; Esc stops the loop."
					: "HTTP 429 and timeout failures keep Pi's bounded retry.";
				ctx.ui.notify(
					`retry: ${result.policy} (decided by ${source})${result.malformed ? "; malformed or unreadable file, falling back to off" : ""}. ${behavior}${projectNote}`,
					result.malformed ? "warning" : "info",
				);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});
}
