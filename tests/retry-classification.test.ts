import assert from "node:assert/strict";
import test from "node:test";
import { classifyTransientFailure } from "../lib/retry-classification.ts";

test("HTTP 429 answers are transient rate-limit failures", () => {
	assert.equal(classifyTransientFailure('Error: 429 {"status":429,"title":"Too Many Requests"}'), "rate_limit");
	assert.equal(classifyTransientFailure("429 Too Many Requests"), "rate_limit");
	assert.equal(classifyTransientFailure("Too Many Requests"), "rate_limit");
	assert.equal(classifyTransientFailure("rate limit exceeded, retry later"), "rate_limit");
	assert.equal(classifyTransientFailure("Rate-Limit reached"), "rate_limit");
});

test("timeout failures are transient", () => {
	assert.equal(classifyTransientFailure("Request timed out after 60000ms"), "timeout");
	assert.equal(classifyTransientFailure("ETIMEDOUT"), "timeout");
	assert.equal(classifyTransientFailure("timeout of 30000 ms exceeded"), "timeout");
	assert.equal(classifyTransientFailure("TimeoutError: awaiting provider response"), "timeout");
	assert.equal(classifyTransientFailure("upstream deadline exceeded"), "timeout");
});

test("quota, billing, and subscription limits are never treated as transient", () => {
	assert.equal(classifyTransientFailure("429 quota exceeded"), undefined);
	assert.equal(classifyTransientFailure("Error: insufficient_quota"), undefined);
	assert.equal(classifyTransientFailure("429 available balance exhausted"), undefined);
	assert.equal(classifyTransientFailure("billing hard limit reached"), undefined);
	assert.equal(classifyTransientFailure("Monthly usage limit reached"), undefined);
	assert.equal(classifyTransientFailure("subscription_sharing_usage_limit_exceeded"), undefined);
});

test("failures outside the 429 and timeout scope are not retried by this policy", () => {
	assert.equal(classifyTransientFailure("401 Unauthorized"), undefined);
	assert.equal(classifyTransientFailure("500 Internal Server Error"), undefined);
	assert.equal(classifyTransientFailure("connection reset by peer"), undefined);
	assert.equal(classifyTransientFailure(""), undefined);
	assert.equal(classifyTransientFailure(undefined), undefined);
});

test("a status number is only a rate limit when it is a whole value", () => {
	assert.equal(classifyTransientFailure("request id 4291 failed"), undefined);
	assert.equal(classifyTransientFailure("x429"), undefined);
	assert.equal(classifyTransientFailure("429"), "rate_limit");
});
