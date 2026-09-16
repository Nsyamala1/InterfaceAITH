import type { Page } from "playwright";

// ---------------------------------------------------------------------------
// Perception: turn the live page into a compact, LLM-readable description of
// what's on screen and what can be acted on, expressed in the same
// {role, label, text} vocabulary as LocatorSpec (see surface/locate.ts).
//
// Deliberately DOM/accessibility-based rather than screenshot-only: this is
// the piece that keeps the approach viable on a surface with no clean DOM --
// role + accessible name comes from the accessibility tree the browser
// already computes for screen readers, not from CSS classes or test IDs, so
// it degrades gracefully on legacy markup instead of depending on it.
// A screenshot is captured alongside for the model as visual grounding and
// for evidence, but the agent's action targets always resolve through roles.
// ---------------------------------------------------------------------------

export interface InteractiveElement {
  index: number;
  role: string;
  name: string;
  tag: string;
  // Set only for table-cell elements (role "cell"): the text of the row's
  // first cell (its label, e.g. "Savings") and this cell's column position.
  // A data cell's own `name` is its dynamic VALUE, which is unique to the
  // record open at discovery time -- unusable as a stable locator identity.
  // The row label is the same on every record's page, so it's what a
  // reusable extract locator has to anchor on instead. See
  // discover/artifactBuilder.ts#locatorFromElement.
  rowLabel?: string;
  cellIndex?: number;
}

export interface PageSnapshot {
  url: string;
  title: string;
  visibleText: string; // truncated body text, for context the model needs to read (balances, confirmation numbers, errors)
  interactive: InteractiveElement[];
}

const INTERACTIVE_SELECTOR =
  "button, a[href], input, select, textarea, [role='button'], [role='link']";

// Data cells (table cells, definition-list values) are not "interactive" in
// the clickable sense, but on a legacy table-layout surface they are exactly
// where the values an "extract" step needs to read live (a balance, a
// confirmation number, a status). Without these in the indexable element
// list, the model has no way to target them and falls back to extracting
// from the nearest clickable element instead -- wrong data, silently.
const READABLE_SELECTOR = "td, th, dd, dt";

export async function snapshotPage(page: Page): Promise<PageSnapshot> {
  const url = page.url();
  const title = await page.title();

  // NOTE: page.evaluate() serializes its callback to a source string and
  // runs it inside the browser, detached from the surrounding module. tsx's
  // esbuild transform wraps every named function/const in the compiled
  // output with a `__name(fn, "name")` call (for stack-trace fidelity), and
  // that helper only exists in the outer Node.js module scope -- so any
  // named binding inside the callback throws "__name is not defined" in the
  // browser regardless of whether it's a `function` declaration or an arrow
  // assigned to `const`. Passing raw JS source as a string sidesteps the
  // transform entirely, since esbuild only rewrites executable syntax, not
  // string contents.
  const snapshotSource = `(() => {
    const accessibleName = (el) => {
      const aria = el.getAttribute("aria-label");
      if (aria) return aria.trim();
      if (el.id) {
        const label = document.querySelector('label[for="' + el.id + '"]');
        if (label && label.textContent) return label.textContent.trim();
      }
      const text = el.innerText ?? el.textContent ?? "";
      return text.trim().slice(0, 120);
    };
    const roleOf = (el) => {
      const explicit = el.getAttribute("role");
      if (explicit) return explicit;
      const tag = el.tagName.toLowerCase();
      if (tag === "a") return "link";
      if (tag === "button") return "button";
      if (tag === "select") return "combobox";
      if (tag === "textarea") return "textbox";
      if (tag === "input") {
        const type = el.type;
        if (type === "submit" || type === "button") return "button";
        if (type === "password") return "textbox";
        return "textbox";
      }
      if (tag === "td") return "cell";
      if (tag === "th") return "columnheader";
      if (tag === "dd") return "definition";
      if (tag === "dt") return "term";
      return tag;
    };
    const cellMeta = (el) => {
      if (el.tagName.toLowerCase() !== "td") return {};
      const row = el.closest("tr");
      if (!row) return {};
      const cells = Array.from(row.children).filter(
        (c) => c.tagName === "TD" || c.tagName === "TH"
      );
      const cellIndex = cells.indexOf(el);
      const labelCell = cells[0];
      if (!labelCell || labelCell === el) return { cellIndex };
      const rowLabel = (labelCell.innerText ?? labelCell.textContent ?? "").trim();
      return rowLabel ? { rowLabel, cellIndex } : { cellIndex };
    };
    const clickable = Array.from(document.querySelectorAll(${JSON.stringify(INTERACTIVE_SELECTOR)}));
    // Only leaf-ish readable cells: skip ones that just wrap a clickable
    // element already captured above (e.g. a <td> containing a link), to
    // avoid presenting the same control twice under two different roles.
    const readable = Array.from(document.querySelectorAll(${JSON.stringify(READABLE_SELECTOR)})).filter(
      (el) => !el.querySelector(${JSON.stringify(INTERACTIVE_SELECTOR)})
    );
    const nodes = [...clickable, ...readable];
    return nodes
      .filter((el) => el.offsetParent !== null)
      .map((el, index) => ({
        index,
        role: roleOf(el),
        name: accessibleName(el),
        tag: el.tagName.toLowerCase(),
        ...cellMeta(el),
      }))
      .filter((el) => el.name.length > 0);
  })()`;
  const interactive: InteractiveElement[] = await page.evaluate(snapshotSource);

  const visibleText = await page.evaluate(() => document.body.innerText.slice(0, 2000));

  return { url, title, visibleText, interactive };
}
