import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveRetryPolicy, writeRetryPolicy } from "../lib/retry-policy.ts";

function fixture() {
	const home = mkdtempSync(join(tmpdir(), "gentle-retry-"));
	const cwd = mkdtempSync(join(tmpdir(), "gentle-retry-cwd-"));
	return { home, cwd, options: { gentlePiConfigHome: home, cwd } };
}

function projectFile(cwd: string): string {
	return join(cwd, ".pi", "gentle-ai", "retry-policy.json");
}

function writeProject(cwd: string, text: string): void {
	mkdirSync(join(cwd, ".pi", "gentle-ai"), { recursive: true });
	writeFileSync(projectFile(cwd), text);
}

test("retry policy defaults off, persists strictly, and fails closed on malformed input", () => {
	const { home, options } = fixture();
	const missing = resolveRetryPolicy(options);
	assert.equal(missing.policy, "off");
	assert.equal(missing.source, "default");
	assert.equal(missing.malformed, false);

	const path = writeRetryPolicy("on", options);
	assert.equal(path, join(home, "retry-policy.json"));
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { schema: "gentle-pi.retry/v1", policy: "on" });
	if (process.platform !== "win32") assert.equal(statSync(path).mode & 0o777, 0o600);

	const enabled = resolveRetryPolicy(options);
	assert.equal(enabled.policy, "on");
	assert.equal(enabled.source, "global_file");
	assert.equal(enabled.malformed, false);

	writeRetryPolicy("off", options);
	assert.equal(resolveRetryPolicy(options).policy, "off");
});

test("malformed global retry files fall back to off without being rewritten", () => {
	const { home, options } = fixture();
	for (const text of [
		"not json",
		"[]",
		'{"schema":"gentle-pi.retry/v2","policy":"on"}',
		'{"schema":"gentle-pi.retry/v1","policy":"maybe"}',
		'{"schema":"gentle-pi.retry/v1","policy":"on","extra":true}',
		'{"policy":"on"}',
		'{"schema":"gentle-pi.retry/v1","policy":"on","baseDelayMs":-1}',
		'{"schema":"gentle-pi.retry/v1","policy":"on","baseDelayMs":1.5}',
		'{"schema":"gentle-pi.retry/v1","policy":"on","maxDelayMs":"5000"}',
	]) {
		writeFileSync(join(home, "retry-policy.json"), text);
		const resolved = resolveRetryPolicy(options);
		assert.equal(resolved.policy, "off", text);
		assert.equal(resolved.malformed, true, text);
		assert.equal(resolved.source, "global_file", text);
		assert.equal(readFileSync(join(home, "retry-policy.json"), "utf8"), text, text);
	}
});

test("an unreadable retry file fails closed instead of enabling the retry loop", () => {
	const { home, options } = fixture();
	mkdirSync(join(home, "retry-policy.json"), { recursive: true });
	const resolved = resolveRetryPolicy(options);
	assert.equal(resolved.policy, "off");
	assert.equal(resolved.malformed, true);
	assert.equal(resolved.source, "global_file");
});

test("a project retry file overrides the global one", () => {
	const { cwd, options } = fixture();
	writeRetryPolicy("on", options);
	assert.equal(resolveRetryPolicy(options).policy, "on");

	writeProject(cwd, '{"schema":"gentle-pi.retry/v1","policy":"off"}');
	const project = resolveRetryPolicy(options);
	assert.equal(project.policy, "off");
	assert.equal(project.source, "project_file");
	assert.equal(project.malformed, false);

	writeProject(cwd, '{"schema":"gentle-pi.retry/v1","policy":"on"}');
	const enabled = resolveRetryPolicy(options);
	assert.equal(enabled.policy, "on");
	assert.equal(enabled.source, "project_file");
});

test("a malformed project retry file fails closed even when the global one is on", () => {
	const { cwd, options } = fixture();
	writeRetryPolicy("on", options);
	writeProject(cwd, "{broken");
	const resolved = resolveRetryPolicy(options);
	assert.equal(resolved.policy, "off");
	assert.equal(resolved.source, "project_file");
	assert.equal(resolved.malformed, true);
	assert.equal(readFileSync(projectFile(cwd), "utf8"), "{broken");
});

test("delay knobs are optional, defaulted, and survive a policy switch", () => {
	const { home, options } = fixture();
	const defaults = resolveRetryPolicy(options);
	assert.equal(defaults.baseDelayMs, 2000);
	assert.equal(defaults.maxDelayMs, 60000);

	writeFileSync(join(home, "retry-policy.json"), '{"schema":"gentle-pi.retry/v1","policy":"on","baseDelayMs":500,"maxDelayMs":10000}');
	const tuned = resolveRetryPolicy(options);
	assert.equal(tuned.policy, "on");
	assert.equal(tuned.baseDelayMs, 500);
	assert.equal(tuned.maxDelayMs, 10000);

	writeRetryPolicy("off", options);
	assert.deepEqual(JSON.parse(readFileSync(join(home, "retry-policy.json"), "utf8")), {
		schema: "gentle-pi.retry/v1",
		policy: "off",
		baseDelayMs: 500,
		maxDelayMs: 10000,
	});
	assert.equal(resolveRetryPolicy(options).baseDelayMs, 500);
});
