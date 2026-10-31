// Which provider failures this policy is allowed to retry forever.
//
// Scope is deliberately narrow: HTTP 429 rate limits and timeouts. Every other
// failure (authentication, server errors, malformed requests) keeps Pi's own
// bounded retry behavior, and quota/billing/subscription limits are never
// retried here because waiting does not restore the account's allowance.

export type TransientFailureKind = "rate_limit" | "timeout";

export const TRANSIENT_FAILURE_LABEL: Record<TransientFailureKind, string> = {
	rate_limit: "HTTP 429 (Too Many Requests)",
	timeout: "provider timeout",
};

// Subscription, quota, and billing exhaustion. Mirrors the provider limit
// wording Pi already refuses to retry: no amount of waiting fixes these.
const QUOTA_PATTERN = /insufficient_quota|out of budget|quota[ _-]?exceeded|billing|available balance|monthly usage limit reached|go.?usage.?limit|free.?usage.?limit|subscription_sharing_.*usage_limit/i;

// A 429 only counts as a whole value: "request id 4291" is not a rate limit.
const RATE_LIMIT_PATTERN = /(?<![a-z0-9])429(?![a-z0-9])|too\s+many\s+requests|rate.?limit/i;

const TIMEOUT_PATTERN = /timed\s*out|timedout|timeout|deadline\s+exceeded/i;

/**
 * Classify a provider failure message. Returns undefined for every failure
 * this policy must not retry, including quota and billing exhaustion.
 */
export function classifyTransientFailure(errorMessage: string | undefined): TransientFailureKind | undefined {
	if (typeof errorMessage !== "string" || errorMessage.trim() === "") return undefined;
	if (QUOTA_PATTERN.test(errorMessage)) return undefined;
	if (RATE_LIMIT_PATTERN.test(errorMessage)) return "rate_limit";
	if (TIMEOUT_PATTERN.test(errorMessage)) return "timeout";
	return undefined;
}
