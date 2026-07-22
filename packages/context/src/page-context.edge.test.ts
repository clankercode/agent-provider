import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { createPageContext } from "./index.js";

function page(markup: string): Document {
  return new JSDOM(markup).window.document;
}

describe("page context precedence and root resolution", () => {
  it("never lets an explicit extractor bypass application redaction", () => {
    const document = page(`
      <main>
        <section class="private" data-agent-provider-redact>attribute secret</section>
        <section class="predicate">predicate secret</section>
      </main>
    `);
    const extractor = vi.fn(() => "extractor leaked a secret");
    const context = createPageContext({
      roots: () => document.querySelector("main"),
      redact: (element) => element.matches(".predicate"),
      extractors: [
        {
          selector: ".private, .predicate",
          extract: extractor,
        },
      ],
    });

    const frame = context.capture();

    expect(frame.content).not.toContain("secret");
    expect(frame.content).not.toContain("extractor leaked");
    expect(extractor).not.toHaveBeenCalled();
    expect(frame.redactions.map((entry) => entry.source)).toEqual([
      "attribute",
      "predicate",
    ]);
  });

  it("accepts iterable roots and resolves them again for each capture", () => {
    const firstDocument = page(`<main><p>First</p><p>Second</p></main>`);
    const secondDocument = page(`<main><p>Replacement</p></main>`);
    let document = firstDocument;
    const roots = vi.fn(() => document.querySelectorAll("p"));
    const context = createPageContext({ roots });

    const first = context.capture();
    document = secondDocument;
    const second = context.capture();

    expect(first.content).toContain("First");
    expect(first.content).toContain("Second");
    expect(second.content).toContain("Replacement");
    expect(second.content).not.toContain("First");
    expect(roots).toHaveBeenCalledTimes(2);
  });

  it("lets configured region semantics suppress an attributed fallback", () => {
    const document = page(`
      <main>
        <section data-agent-provider-region="summary">Automatic summary</section>
      </main>
    `);
    const context = createPageContext({
      roots: () => document.querySelector("main"),
      regions: { summary: () => null },
    });

    const frame = context.capture();

    expect(frame.regions).toEqual([]);
    expect(context.getRegion("summary", frame)).toBeUndefined();
  });
});
