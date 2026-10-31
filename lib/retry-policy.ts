import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { gentlePiConfigHome } from "./agent-home.ts";

// The retry preference is Gentle Shell's own: it lives in the Gentle config
// home (and, optionally, in a project override) and never in Pi's settings.json.
// Pi owns the request machinery; this file only decides whether a transient
// provider failure ends the run or is retried forever.
export const RETRY_POLICY = { ON: "on", OFF: "off" } as const;
export type RetryPolicy = (typeof RETRY_POLICY)[keyof typeof RETRY_POLICY];
export const RETRY_POLICY_SCHEMA = "gentle-pi.retry/v1";
export const RETRY_POLICY_FILE = "retry-policy.json";
/** Minimum spacing between two provider attempts, and its ceiling. */
export const RETRY_POLICY_DEFAULT_BASE_DELAY_MS = 2_000;
export const RETRY_POLICY_DEFAULT_MAX_DELAY_MS = 60_000;

export interface RetryPolicyOptions {
	/** Override the Gentle config home (tests and isolated runs). */
	gentlePiConfigHome?: string;
	/** Project directory whose `.pi/gentle-ai/retry-policy.json` overrides the global file. */
	cwd?: string;
}

export interface RetryPolicyResolution {
	/** The effective preference. Malformed or unreadable files fail closed to off. */
	policy: RetryPolicy;
	/** Minimum spacing between two provider attempts. */
	baseDelayMs: number;
	/** Ceiling for the growing spacing between two provider attempts. */
	maxDelayMs: number;
	/** Which file decided the preference. */
	source: "project_file" | "global_file" | "default";
	/** True when a present file could not be read or did not match the strict shape. */
	malformed: boolean;
	globalFile: string;
	projectFile?: string;
}

/** The strict file shape: `schema` and `policy`, plus optional delay knobs. */
export interface ParsedRetryPolicy {
	policy: RetryPolicy;
	baseDelayMs?: number;
	maxDelayMs?: number;
}

function delayValue(value: unknown): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return undefined;
	return value;
}

/**
 * Strict shape: the known schema id, a known policy, and optional non-negative
 * integer delays. Any other key, value, or shape is rejected, so a typo can
 * never silently enable or reshape the retry loop.
 */
export function parseRetryPolicyFile(raw: string): ParsedRetryPolicy | undefined {
	try {
		const value: unknown = JSON.parse(raw);
		if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
		const keys = Object.keys(value);
		if (keys.some((key) => key !== "schema" && key !== "policy" && key !== "baseDelayMs" && key !== "maxDelayMs")) return undefined;
		if (!("schema" in value) || value.schema !== RETRY_POLICY_SCHEMA) return undefined;
		if (!("policy" in value)) return undefined;
		if (value.policy !== RETRY_POLICY.ON && value.policy !== RETRY_POLICY.OFF) return undefined;
		const baseDelayMs = delayValue("baseDelayMs" in value ? value.baseDelayMs : undefined);
		if (baseDelayMs === undefined && "baseDelayMs" in value) return undefined;
		const maxDelayMs = delayValue("maxDelayMs" in value ? value.maxDelayMs : undefined);
		if (maxDelayMs === undefined && "maxDelayMs" in value) return undefined;
		return {
			policy: value.policy,
			...(baseDelayMs === undefined ? {} : { baseDelayMs }),
			...(maxDelayMs === undefined ? {} : { maxDelayMs }),
		};
	} catch {
		return undefined;
	}
}

interface PolicyFileRead {
	parsed?: ParsedRetryPolicy;
	malformed: boolean;
	missing: boolean;
}

function readPolicyFile(path: string): PolicyFileRead {
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch (error) {
		const missing = typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
		return { malformed: !missing, missing };
	}
	const parsed = parseRetryPolicyFile(raw);
	return { parsed, malformed: parsed === undefined, missing: false };
}

function delays(parsed: ParsedRetryPolicy | undefined): { baseDelayMs: number; maxDelayMs: number } {
	return {
		baseDelayMs: parsed?.baseDelayMs ?? RETRY_POLICY_DEFAULT_BASE_DELAY_MS,
		maxDelayMs: parsed?.maxDelayMs ?? RETRY_POLICY_DEFAULT_MAX_DELAY_MS,
	};
}

/**
 * Resolve the effective retry preference. A project file wins over the global
 * one; a present but malformed file fails closed to off instead of falling
 * back to a file that would silently change the decision.
 */
export function resolveRetryPolicy(options: RetryPolicyOptions = {}): RetryPolicyResolution {
	const home = options.gentlePiConfigHome ?? gentlePiConfigHome();
	const globalFile = join(home, RETRY_POLICY_FILE);
	const projectFile = options.cwd ? join(options.cwd, ".pi", "gentle-ai", RETRY_POLICY_FILE) : undefined;
	if (projectFile !== undefined) {
		const project = readPolicyFile(projectFile);
		if (!project.missing) {
			return {
				policy: project.malformed ? RETRY_POLICY.OFF : project.parsed!.policy,
				...delays(project.malformed ? undefined : project.parsed),
				source: "project_file",
				malformed: project.malformed,
				globalFile,
				projectFile,
			};
		}
	}
	const global = readPolicyFile(globalFile);
	if (global.missing) {
		return { policy: RETRY_POLICY.OFF, ...delays(undefined), source: "default", malformed: false, globalFile, projectFile };
	}
	return {
		policy: global.malformed ? RETRY_POLICY.OFF : global.parsed!.policy,
		...delays(global.malformed ? undefined : global.parsed),
		source: "global_file",
		malformed: global.malformed,
		globalFile,
		projectFile,
	};
}

/**
 * Persist the global preference atomically, keeping every other file untouched.
 * Hand-tuned delay knobs survive a policy switch; a malformed file is replaced.
 */
export function writeRetryPolicy(policy: RetryPolicy, options: RetryPolicyOptions = {}): string {
	const home = options.gentlePiConfigHome ?? gentlePiConfigHome();
	const path = join(home, RETRY_POLICY_FILE);
	const existing = readPolicyFile(path).parsed;
	const payload: Record<string, unknown> = { schema: RETRY_POLICY_SCHEMA, policy };
	if (existing?.baseDelayMs !== undefined) payload.baseDelayMs = existing.baseDelayMs;
	if (existing?.maxDelayMs !== undefined) payload.maxDelayMs = existing.maxDelayMs;
	const temporary = `${path}.${randomUUID()}.tmp`;
	mkdirSync(home, { recursive: true });
	try {
		writeFileSync(temporary, `${JSON.stringify(payload)}\n`, { flag: "wx", mode: 0o600 });
		renameSync(temporary, path);
	} finally {
		try { unlinkSync(temporary); } catch { /* Rename consumed the temporary file. */ }
	}
	return path;
}
