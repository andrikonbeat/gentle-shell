import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import gentleRetry from "../extensions/gentle-retry.ts";
import { COMMAND_PALETTE_CATALOG } from "../lib/command-palette-catalog.ts";
import { RETRY_POLICY_SCHEMA } from "../lib/retry-policy.ts";

const RATE_LIMIT_ERROR = 'Error: 429 {"status":429,"title":"Too Many Requests"}';

function failedAssistant(errorMessage: string) {
	return { role: "assistant", content: [], provider: "openai", model: "gpt-4o", stopReason: "error", errorMessage };
}

function settledAssistant() {
	return { role: "assistant", content: [{ type: "text", text: "done" }], provider: "openai", model: "gpt-4o", stopReason: "stop" };
}

function harness(policy: "on" | "off" | null = "on", extra: Record<string, unknown> = {}) {
	const configHome = mkdtempSync(join(tmpdir(), "gentle-retry-extension-"));
	if (policy !== null) {
		writeFileSync(join(configHome, "retry-policy.json"), JSON.stringify({ schema: RETRY_POLICY_SCHEMA, policy, ...extra }));
	}
	const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
	const commands = new Map<string, { description: string; handler: (args: string, ctx: unknown) => Promise<void> }>();
	const notifications: { message: string; level?: string }[] = [];
	const delays: { ms: number; signal?: AbortSignal }[] = [];
	const ctx: any = {
		cwd: "/fixture",
		mode: "tui",
		hasUI: true,
		ui: { notify: (message: string, level?: string) => notifications.push({ message, level }) },
		signal: undefined as AbortSignal | undefined,
	};
	const pi: any = {
		on: (name: string, handler: (event: unknown, ctx: unknown) => unknown) => handlers.set(name, handler),
		registerCommand: (name: string, command: { description: string; handler: (args: string, ctx: unknown) => Promise<void> }) => commands.set(name, command),
	};
	gentleRetry(pi, {}, {
		gentlePiConfigHome: configHome,
		sleep: async (ms: number, signal?: AbortSignal) => { delays.push({ ms, signal }); },
	});
	return {
		configHome,
		commands,
		notifications,
		delays,
		ctx,
		emit: (name: string, event: unknown, context: unknown = ctx) => handlers.get(name)?.(event, context),
	};
}

function settleEvent(entries: { id: string; message: unknown }[], outcome = "error") {
	return {
		type: "agent_before_settle",
		outcome,
		entries: [],
		continue: false,
		context: {
			contextEntries: entries.map((entry) => ({
				sourceEntry: { type: "message", id: entry.id, message: entry.message },
				messages: [entry.message],
			})),
			contextMessages: entries.map((entry) => entry.message),
			llmMessages: [],
			pendingMessages: [],
			canContinue: true,
		},
	};
}

test("the retry policy off leaves Pi's own bounded retry untouched", async () => {
	const h = harness("off");
	const result = await h.emit("agent_before_settle", settleEvent([{ id: "assistant-1", message: failedAssistant(RATE_LIMIT_ERROR) }]));
	assert.equal(result, undefined);
	assert.deepEqual(h.notifications, []);
});

test("a missing retry policy keeps the default off behavior", async () => {
	const h = harness(null);
	const result = await h.emit("agent_before_settle", settleEvent([{ id: "assistant-1", message: failedAssistant(RATE_LIMIT_ERROR) }]));
	assert.equal(result, undefined);
});

test("a 429 failure continues the run and omits the failed attempt from the model context", async () => {
	const h = harness("on");
	const result = await h.emit("agent_before_settle", settleEvent([{ id: "assistant-1", message: failedAssistant(RATE_LIMIT_ERROR) }])) as any;
	assert.equal(result.continue, true);
	assert.deepEqual(result.entries, [{ type: "context_edit", targetId: "assistant-1", replacement: null }]);
	assert.equal(h.notifications.length, 1);
	assert.match(h.notifications[0]!.message, /429/);
	assert.match(h.notifications[0]!.message, /Esc/);
});

test("a timeout failure continues the run", async () => {
	const h = harness("on");
	const result = await h.emit("agent_before_settle", settleEvent([{ id: "assistant-1", message: failedAssistant("Request timed out after 60000ms") }])) as any;
	assert.equal(result.continue, true);
	assert.deepEqual(result.entries, [{ type: "context_edit", targetId: "assistant-1", replacement: null }]);
	assert.match(h.notifications[0]!.message, /timeout/i);
});

test("failures outside the transient scope are never retried", async () => {
	for (const errorMessage of ["401 Unauthorized", "500 Internal Server Error", "429 quota exceeded", "insufficient_quota"]) {
		const h = harness("on");
		const result = await h.emit("agent_before_settle", settleEvent([{ id: "assistant-1", message: failedAssistant(errorMessage) }]));
		assert.equal(result, undefined, errorMessage);
		assert.deepEqual(h.notifications, [], errorMessage);
	}
});

test("a completed run is never retried", async () => {
	const h = harness("on");
	const result = await h.emit("agent_before_settle", settleEvent([{ id: "assistant-1", message: settledAssistant() }], "completed"));
	assert.equal(result, undefined);
});

test("the failed attempt must be the last projected message", async () => {
	const h = harness("on");
	const result = await h.emit("agent_before_settle", settleEvent([
		{ id: "assistant-1", message: failedAssistant(RATE_LIMIT_ERROR) },
		{ id: "user-1", message: { role: "user", content: "later message" } },
	]));
	assert.equal(result, undefined);
});

test("the spacing between attempts grows and stays capped", async () => {
	const h = harness("on", { baseDelayMs: 100, maxDelayMs: 300 });
	for (let attempt = 0; attempt < 5; attempt++) {
		await h.emit("turn_end", { type: "turn_end", outcome: "error", message: failedAssistant(RATE_LIMIT_ERROR), toolResults: [] }, h.ctx);
	}
	assert.deepEqual(h.delays.map((delay) => delay.ms), [100, 200, 300, 300, 300]);
});

test("the spacing wait receives the live abort signal so Escape can interrupt it", async () => {
	const h = harness("on");
	const controller = new AbortController();
	h.ctx.signal = controller.signal;
	await h.emit("turn_end", { type: "turn_end", outcome: "error", message: failedAssistant(RATE_LIMIT_ERROR), toolResults: [] }, h.ctx);
	assert.equal(h.delays.length, 1);
	assert.equal(h.delays[0]!.signal, controller.signal);
});

test("a successful turn resets the spacing", async () => {
	const h = harness("on", { baseDelayMs: 100, maxDelayMs: 300 });
	await h.emit("turn_end", { type: "turn_end", outcome: "error", message: failedAssistant(RATE_LIMIT_ERROR), toolResults: [] }, h.ctx);
	await h.emit("turn_end", { type: "turn_end", outcome: "completed", message: settledAssistant(), toolResults: [] }, h.ctx);
	await h.emit("turn_end", { type: "turn_end", outcome: "error", message: failedAssistant(RATE_LIMIT_ERROR), toolResults: [] }, h.ctx);
	assert.deepEqual(h.delays.map((delay) => delay.ms), [100, 100]);
});

test("/gentle:retry reports and persists the preference", async () => {
	const h = harness("off");
	const command = h.commands.get("gentle:retry");
	assert.ok(command);
	await command.handler("status", h.ctx);
	assert.match(h.notifications.at(-1)!.message, /off/);

	await command.handler("enable", h.ctx);
	assert.deepEqual(JSON.parse(readFileSync(join(h.configHome, "retry-policy.json"), "utf8")), { schema: RETRY_POLICY_SCHEMA, policy: "on" });
	assert.match(h.notifications.at(-1)!.message, /on/);

	await command.handler("disable", h.ctx);
	assert.equal(JSON.parse(readFileSync(join(h.configHome, "retry-policy.json"), "utf8")).policy, "off");
});

test("/gentle:retry refuses an unknown action", async () => {
	const h = harness("off");
	const command = h.commands.get("gentle:retry");
	assert.ok(command);
	await command.handler("maybe", h.ctx);
	assert.match(h.notifications.at(-1)!.message, /status\|enable\|disable/);
	assert.equal(JSON.parse(readFileSync(join(h.configHome, "retry-policy.json"), "utf8")).policy, "off");
});

test("the retry command is registered and offered in the command palette", () => {
	const h = harness("off");
	assert.ok(h.commands.has("gentle:retry"));
	const catalog = COMMAND_PALETTE_CATALOG.flatMap((group) => group.items.map((item) => item.command));
	assert.ok(catalog.includes("gentle:retry"));
});
