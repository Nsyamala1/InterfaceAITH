// ---------------------------------------------------------------------------
// Redaction: never persist secrets or raw sensitive data into artifacts or
// logs. This is applied at the point of writing to disk (logger + artifact
// writer), not left to callers to remember.
//
// Scope deliberately narrow and pattern-based rather than a general PII
// classifier -- that's a research problem on its own; here we cover the
// concrete regulated-data shapes this project actually produces:
//   - password fields (never logged at all, see log/logger.ts field denylist)
//   - dollar amounts / account balances -> kept but the *raw* value from a
//     "type" action targeting a field named like a credential is dropped
//   - long digit runs that look like account/card numbers -> masked
// ---------------------------------------------------------------------------

const DIGIT_RUN = /\b\d{6,}\b/g;

export function redactText(input: string): string {
  return input.replace(DIGIT_RUN, (match) => "*".repeat(match.length - 4) + match.slice(-4));
}

const SENSITIVE_FIELD_NAME = /password|secret|token|ssn|creditcard|cvv/i;

export function isSensitiveFieldName(name: string | undefined): boolean {
  if (!name) return false;
  return SENSITIVE_FIELD_NAME.test(name);
}

export function redactTypedValue(fieldName: string | undefined, value: string): string {
  if (isSensitiveFieldName(fieldName)) return "[REDACTED]";
  return redactText(value);
}
