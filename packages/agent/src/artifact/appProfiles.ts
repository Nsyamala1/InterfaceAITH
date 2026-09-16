import type { KnownOutcome } from "./schema.js";

// ---------------------------------------------------------------------------
// Per-vendor-app known-outcome catalog, keyed by logical appId rather than by
// tenant. A discovery run only ever demonstrates the happy path once; the
// runtime error taxonomy it ships with comes from this shared, human-authored
// profile of the app, reviewed once and attached to every artifact recorded
// against it. This is also the multi-tenant reuse seam: the same appId
// profile applies to every tenant instance of this vendor product, and a
// tenant-specific override would layer on top of (not replace) this list --
// see REPORT.md "Heterogeneity & multi-tenant".
// ---------------------------------------------------------------------------
export const meridianTellerConsoleKnownOutcomes: KnownOutcome[] = [
  {
    code: "MEMBER_NOT_FOUND",
    category: "business",
    description: "No member exists with the given ID.",
    detection: { kind: "textContains", text: "No member found with ID", timeoutMs: 1000 },
  },
  {
    code: "PERMISSION_DENIED",
    category: "business",
    description: "The member record is restricted and the current teller is not authorized to view it.",
    detection: { kind: "textContains", text: "not authorized to view member", timeoutMs: 1000 },
  },
  {
    code: "VALIDATION_ERROR",
    category: "business",
    description: "The sub-account form was submitted with an invalid initial deposit.",
    detection: { kind: "textContains", text: "Initial deposit must be a number", timeoutMs: 1000 },
  },
  {
    code: "SESSION_EXPIRED",
    category: "recoverable",
    description: "The teller session expired mid-flow and the app redirected to a login/expired page.",
    detection: { kind: "textContains", text: "Your session has expired", timeoutMs: 1000 },
    recovery: { action: "reauthenticate", maxAttempts: 1 },
  },
];
