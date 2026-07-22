import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { createPageContext, DEFAULT_CONTEXT_LIMITS } from "./index.js";

function page(markup: string): Document {
  return new JSDOM(markup).window.document;
}

describe("createPageContext", () => {
  it("extracts ordinary forms while excluding sensitive controls", () => {
    const document = page(`
      <main>
        <label>Email <input name="email" value="reader@example.test"></label>
        <label>Updates <input type="checkbox" name="updates" checked></label>
        <label>Team
          <select name="team"><option>Blue</option><option selected>Gold</option></select>
        </label>
        <label>Password <input type="password" value="hunter2"></label>
        <input type="hidden" name="csrf_token" value="hidden-secret">
        <input name="api_key" value="key-secret">
        <input name="one_time_code" value="123456">
        <input autocomplete="cc-number" value="4111111111111111">
        <input type="file" name="upload">
        <textarea name="session_token">textarea-secret</textarea>
        <select name="payment_method"><option selected>private-card</option></select>
      </main>
    `);
    const context = createPageContext({
      roots: () => document.querySelector("main"),
    });

    const frame = context.capture();

    expect(frame.content).toContain("Email: reader@example.test");
    expect(frame.content).toContain("[x] Updates");
    expect(frame.content).toContain("Team: Gold");
    expect(frame.content).not.toContain("hunter2");
    expect(frame.content).not.toContain("hidden-secret");
    expect(frame.content).not.toContain("key-secret");
    expect(frame.content).not.toContain("123456");
    expect(frame.content).not.toContain("4111111111111111");
    expect(frame.content).not.toContain("textarea-secret");
    expect(frame.content).not.toContain("private-card");
    expect(frame.redactions.map((redaction) => redaction.reason)).toEqual(
      expect.arrayContaining([
        "password",
        "hidden",
        "token-like",
        "one-time-code",
        "payment",
        "file",
      ]),
    );
  });

  it("lets application redaction win over automatic extraction and explicit extractors provide safe replacements", () => {
    const document = page(`
      <main>
        <section data-agent-provider-redact>private account notes</section>
        <p class="private">private predicate text</p>
        <label>Access token <input class="safe-token" data-agent-provider-redact name="access_token" value="raw-token"></label>
        <p class="computed">unhelpful widget internals</p>
      </main>
    `);
    const context = createPageContext({
      roots: () => document.querySelector("main"),
      redact: (element) => element.matches(".private"),
      extractors: [
        {
          name: "safe-token-state",
          selector: ".safe-token",
          extract: () => "\n- Access token: configured\n",
        },
        (element) =>
          element.matches(".computed")
            ? { content: "Current computed status: ready" }
            : undefined,
      ],
    });

    const frame = context.capture();

    expect(frame.content).not.toContain("private account notes");
    expect(frame.content).not.toContain("private predicate text");
    expect(frame.content).not.toContain("raw-token");
    expect(frame.content).toContain("Access token: configured");
    expect(frame.content).toContain("Current computed status: ready");
    expect(frame.redactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "attribute" }),
        expect.objectContaining({ source: "predicate" }),
      ]),
    );
    expect(
      frame.redactions.every(
        (redaction) => !redaction.path.includes("private"),
      ),
    ).toBe(true);
  });

  it("discovers configured and attributed regions with deterministic limits", () => {
    const document = page(`
      <main>
        <section id="summary" data-agent-provider-region="summary">Summary A</section>
        <section data-agent-provider-region="activity">Activity A</section>
        <aside id="details">Details A</aside>
      </main>
    `);
    const context = createPageContext({
      roots: () => document.querySelector("main"),
      regions: {
        details: () => document.querySelector("#details"),
      },
      clock: () => new Date("2026-07-23T00:00:00.000Z"),
    });

    const frame = context.full();
    expect(
      context.listRegions(frame).map((region) => [region.name, region.source]),
    ).toEqual([
      ["details", "configured"],
      ["summary", "attribute"],
      ["activity", "attribute"],
    ]);
    expect(context.getRegion("summary", frame)).toMatchObject({
      revision: frame.revision,
      capturedAt: frame.capturedAt,
      content: "Summary A",
    });

    const limited = createPageContext({
      roots: () => document.querySelector("main"),
      limits: { maxRegions: 1 },
    }).capture();
    expect(limited.regions.map((region) => region.name)).toEqual(["summary"]);
    expect(limited.truncation.regions).toEqual({ limit: 1, omitted: 1 });
    expect(limited.truncation.truncated).toBe(true);
  });

  it("bounds UTF-8, depth, and form values without splitting code points", () => {
    const document = page(`
      <main><div><div><p>too deep</p></div></div><input aria-label="Note"></main>
    `);
    const input = document.querySelector("input")!;
    (input as HTMLInputElement).value = "ééé";
    const context = createPageContext({
      roots: () => document.querySelector("main"),
      limits: { maxBytes: 12, maxDepth: 1, maxValueBytes: 5 },
    });

    const first = context.capture();
    const second = context.capture();

    expect(
      new TextEncoder().encode(first.content).byteLength,
    ).toBeLessThanOrEqual(12);
    expect(first.content).not.toContain("�");
    expect(first.content).not.toContain("too deep");
    expect(first.truncation.depth.omittedNodes).toBeGreaterThan(0);
    expect(first.truncation.values).toEqual({
      limit: 5,
      truncated: 1,
      omittedBytes: 2,
    });
    expect(first.truncation.bytes.after).toBeLessThanOrEqual(12);
    expect(second.content).toBe(first.content);
    expect(second.truncation).toEqual(first.truncation);
  });

  it("creates immutable revisions and keeps frame-bound region reads stable across root refreshes", () => {
    const document = page(
      `<main><section data-agent-provider-region="status">Ready</section></main>`,
    );
    let currentRoot = document.querySelector("main")!;
    const resolveRoot = vi.fn(() => currentRoot);
    const context = createPageContext({ roots: resolveRoot });

    const first = context.capture();
    currentRoot = page(
      `<main><section data-agent-provider-region="status">Paused</section></main>`,
    ).querySelector("main")!;
    const second = context.capture();

    expect(resolveRoot).toHaveBeenCalledTimes(2);
    expect([first.revision, second.revision]).toEqual([1, 2]);
    expect(first.content).toContain("Ready");
    expect(second.content).toContain("Paused");
    expect(context.getRegion("status", first)?.content).toBe("Ready");
    expect(context.getRegion("status", second)?.content).toBe("Paused");
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.regions)).toBe(true);
    expect(Object.isFrozen(first.truncation.bytes)).toBe(true);
    expect(() => {
      (first.regions as ContextFrameMutable["regions"]).push({});
    }).toThrow();
  });

  it("resolves iterable roots at capture time and does not consume a revision on failed extraction", () => {
    const document = page(`<main>One</main><main>Two</main>`);
    let fail = true;
    const context = createPageContext({
      roots: () => document.querySelectorAll("main"),
      extractors: [
        () => {
          if (fail) throw new Error("extractor failed");
          return undefined;
        },
      ],
    });

    expect(() => context.capture()).toThrow("extractor failed");
    fail = false;
    const first = context.capture();

    expect(first.revision).toBe(1);
    expect(first.content).toContain("One");
    expect(first.content).toContain("Two");
  });

  it("reports changed and removed regions between explicit revisions", () => {
    const document = page(`
      <main>
        <section data-agent-provider-region="status">Ready</section>
        <section data-agent-provider-region="obsolete">Old</section>
      </main>
    `);
    const root = document.querySelector("main")!;
    const context = createPageContext({ roots: () => root });
    const base = context.capture();
    root.querySelector('[data-agent-provider-region="status"]')!.textContent =
      "Paused";
    root.querySelector('[data-agent-provider-region="obsolete"]')!.remove();
    const next = context.capture();

    const delta = context.diff(base, next);

    expect(delta).toMatchObject({
      baseRevision: 1,
      nextRevision: 2,
      contentChanged: true,
      removedRegions: ["obsolete"],
    });
    expect(delta.changedRegions).toHaveLength(1);
    expect(delta.changedRegions[0]).toMatchObject({
      name: "status",
      content: "Paused",
    });
    expect(Object.isFrozen(delta.changedRegions)).toBe(true);
  });

  it("publishes the required defaults and validates overrides", () => {
    expect(DEFAULT_CONTEXT_LIMITS).toEqual({
      maxBytes: 32 * 1024,
      maxDepth: 32,
      maxRegions: 128,
      maxValueBytes: 4 * 1024,
    });
    expect(() =>
      createPageContext({
        roots: () => null,
        limits: { maxDepth: -1 },
      }),
    ).toThrow(RangeError);
  });
});

type ContextFrameMutable = { regions: unknown[] };
