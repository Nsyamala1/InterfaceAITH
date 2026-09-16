// ---------------------------------------------------------------------------
// Safety guardrails.
//
// Two separate mechanisms, both enforced by the agent loop (discovery) and by
// the replay engine, not just documented:
//
// 1. Allowlist: which domains/routes and which action types the agent may
//    touch at all. Anything outside this is refused before it happens, not
//    caught after.
// 2. Risk classification: of the actions the allowlist permits, which are
//    reversible (safe to let the agent do autonomously) vs. irreversible
//    (money movement, account creation) -- these require the artifact to be
//    marked `requiresApprovalToReplayUnattended` and, during discovery, the
//    agent must not click past a native confirm() dialog on its own without
//    it being an explicit, logged, allowlisted action.
// ---------------------------------------------------------------------------

export interface AllowlistConfig {
  allowedOrigins: string[]; // exact origin prefixes, e.g. "http://localhost:3000"
  allowedRoutePatterns: RegExp[]; // paths the agent may navigate to
  allowedActionTypes: Array<"navigate" | "click" | "type" | "select" | "extract" | "waitFor">;
  irreversibleRoutePatterns: RegExp[]; // routes whose actions are treated as irreversible
}

export const defaultAllowlist: AllowlistConfig = {
  allowedOrigins: ["http://localhost:3000"],
  allowedRoutePatterns: [
    /^\/login$/,
    /^\/members\/search(\?.*)?$/,
    /^\/members\/[A-Za-z0-9_-]+$/,
    /^\/members\/[A-Za-z0-9_-]+\/sub-accounts\/new$/,
    /^\/members\/[A-Za-z0-9_-]+\/sub-accounts$/,
  ],
  allowedActionTypes: ["navigate", "click", "type", "select", "extract", "waitFor"],
  irreversibleRoutePatterns: [/^\/members\/[A-Za-z0-9_-]+\/sub-accounts$/],
};

export class AllowlistViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AllowlistViolation";
  }
}

export function assertUrlAllowed(url: string, config: AllowlistConfig): void {
  const parsed = new URL(url);
  const origin = `${parsed.protocol}//${parsed.host}`;
  if (!config.allowedOrigins.includes(origin)) {
    throw new AllowlistViolation(`Origin not in allowlist: ${origin}`);
  }
  const pathWithQuery = parsed.pathname + parsed.search;
  const routeOk = config.allowedRoutePatterns.some(
    (re) => re.test(parsed.pathname) || re.test(pathWithQuery)
  );
  if (!routeOk) {
    throw new AllowlistViolation(`Route not in allowlist: ${parsed.pathname}`);
  }
}

export function assertActionTypeAllowed(
  actionType: string,
  config: AllowlistConfig
): void {
  if (!config.allowedActionTypes.includes(actionType as never)) {
    throw new AllowlistViolation(`Action type not in allowlist: ${actionType}`);
  }
}

export function isIrreversibleRoute(path: string, config: AllowlistConfig): boolean {
  return config.irreversibleRoutePatterns.some((re) => re.test(path));
}

export function classifyRisk(path: string, config: AllowlistConfig): "safe" | "irreversible" {
  return isIrreversibleRoute(path, config) ? "irreversible" : "safe";
}
