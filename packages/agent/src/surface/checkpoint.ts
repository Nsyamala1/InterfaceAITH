import type { Page } from "playwright";
import type { Checkpoint } from "../artifact/schema.js";
import { resolveLocator } from "./locate.js";

// ---------------------------------------------------------------------------
// Checkpoint evaluation: assert the page actually reached the state a step
// (or the whole run) expects. Returns a boolean rather than throwing, so
// callers (replay engine) can use it both for "did this step succeed" and
// for "does this known outcome's detection match right now."
// ---------------------------------------------------------------------------
export async function evaluateCheckpoint(page: Page, checkpoint: Checkpoint): Promise<boolean> {
  switch (checkpoint.kind) {
    case "urlMatches": {
      if (!checkpoint.urlPattern) return false;
      const { pathname, search } = new URL(page.url());
      return new RegExp(checkpoint.urlPattern).test(pathname + search);
    }
    case "elementVisible": {
      if (!checkpoint.target) return false;
      try {
        await resolveLocator(page, checkpoint.target, checkpoint.timeoutMs);
        return true;
      } catch {
        return false;
      }
    }
    case "elementNotVisible": {
      if (!checkpoint.target) return false;
      try {
        await resolveLocator(page, checkpoint.target, Math.min(checkpoint.timeoutMs, 1500));
        return false;
      } catch {
        return true;
      }
    }
    case "textContains": {
      if (!checkpoint.text) return false;
      const body = await page.evaluate(() => document.body.innerText);
      return body.includes(checkpoint.text);
    }
  }
}
