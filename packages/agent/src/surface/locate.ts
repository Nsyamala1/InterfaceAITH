import type { Page, Locator } from "playwright";
import type { LocatorSpec } from "../artifact/schema.js";

// ---------------------------------------------------------------------------
// The seam between "how we perceive/act on a surface" and "the recorded
// flow": both discovery (surface/perceive.ts) and replay (replay/engine.ts)
// resolve a LocatorSpec through this single function. Perception describes
// elements using the same {role, label, text, css} vocabulary that locators
// are expressed in, so a step recorded during discovery and a step executed
// during replay always mean the same thing by "this control."
//
// Fallback chain: try primary, then each fallback in order. This is what
// lets an artifact survive small markup changes (e.g. a wrapping <span>
// added around button text) without being re-recorded.
// ---------------------------------------------------------------------------

function toLocator(page: Page, ref: LocatorSpec["primary"]): Locator {
  switch (ref.by) {
    case "role":
      return page.getByRole(ref.role as never, ref.name ? { name: ref.name } : undefined);
    case "label":
      return page.getByLabel(ref.name ?? "");
    case "text":
      return page.getByText(ref.text ?? "", { exact: false });
    case "css":
      return page.locator(ref.css ?? "");
  }
}

export interface ResolvedLocator {
  locator: Locator;
  usedStrategy: LocatorSpec["primary"]["by"];
  usedFallbackIndex: number | null; // null = primary succeeded
}

export async function resolveLocator(
  page: Page,
  spec: LocatorSpec,
  timeoutMs = 3000
): Promise<ResolvedLocator> {
  const candidates: Array<{ ref: LocatorSpec["primary"]; fallbackIndex: number | null }> = [
    { ref: spec.primary, fallbackIndex: null },
    ...spec.fallbacks.map((ref, i) => ({ ref, fallbackIndex: i })),
  ];

  let lastError: unknown;
  for (const { ref, fallbackIndex } of candidates) {
    try {
      const locator = toLocator(page, ref);
      await locator.first().waitFor({ state: "visible", timeout: timeoutMs });
      return { locator: locator.first(), usedStrategy: ref.by, usedFallbackIndex: fallbackIndex };
    } catch (err) {
      lastError = err;
    }
  }
  throw new LocatorResolutionError(
    `Could not resolve locator (tried ${candidates.length} strategies): ${spec.reasoning}`,
    lastError
  );
}

export class LocatorResolutionError extends Error {
  cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "LocatorResolutionError";
    this.cause = cause;
  }
}
