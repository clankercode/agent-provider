import {
  DEFAULT_CONTEXT_LIMITS,
  type ContextExtractionContext,
  type ContextExtractorDeclaration,
  type ContextExtractorOutput,
  type ContextFrame,
  type ContextFrameDiff,
  type ContextLimits,
  type ContextRedaction,
  type ContextRedactionPredicate,
  type ContextRegion,
  type ContextRegionDefinition,
  type ContextRegionMetadata,
  type ContextRegionSource,
  type ContextRootResult,
  type ContextTruncation,
  type ContextTruncationReason,
  type CreatePageContextOptions,
  type PageContext,
} from "./types.js";

const REGION_ATTRIBUTE = "data-agent-provider-region";
const REDACT_ATTRIBUTE = "data-agent-provider-redact";
const REDACTED_MARKER = "[Redacted]";
const DEPTH_MARKER = "[Content truncated: depth]";
const textEncoder = new TextEncoder();

const OMITTED_ELEMENTS = new Set([
  "SCRIPT",
  "STYLE",
  "TEMPLATE",
  "NOSCRIPT",
  "SVG",
  "CANVAS",
]);

const BLOCK_ELEMENTS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DETAILS",
  "DIALOG",
  "DIV",
  "FIELDSET",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "HEADER",
  "LEGEND",
  "MAIN",
  "NAV",
  "P",
  "SECTION",
  "SUMMARY",
]);

const SENSITIVE_INPUT_TYPES = new Set(["file", "hidden", "password"]);
const SENSITIVE_AUTOCOMPLETE =
  /(?:^|\s)(?:cc-[^\s]+|one-time-code|current-password|new-password|transaction-amount|transaction-currency)(?:\s|$)/i;
const SENSITIVE_CONTROL_NAME =
  /(?:^|[\s_.:-])(?:password|passwd|passcode|pin|otp|one[\s_.:-]*time|token|secret|api[\s_.:-]*key|access[\s_.:-]*key|auth(?:entication|orization)?|bearer|payment|credit[\s_.:-]*card|card[\s_.:-]*(?:number|no)|cvv|cvc|iban|routing[\s_.:-]*number)(?:$|[\s_.:-])/i;

interface RegionRoots {
  readonly name: string;
  readonly source: ContextRegionSource;
  readonly roots: readonly Element[];
}

interface RenderState {
  readonly limits: ContextLimits;
  readonly predicates: readonly ContextRedactionPredicate[];
  readonly extractors: readonly ContextExtractorDeclaration[];
  readonly regionName: string | null;
  readonly redactionDecisions: WeakMap<Element, RedactionDecision | false>;
  readonly redactions: ContextRedaction[];
  readonly redactionKeys: Set<string>;
  depthOmissions: number;
  valueTruncations: number;
  valueOmittedBytes: number;
}

interface RedactionDecision {
  readonly source: ContextRedaction["source"];
  readonly reason: string;
}

interface RenderedCapture {
  readonly content: string;
  readonly redactions: readonly ContextRedaction[];
  readonly truncation: ContextTruncation;
}

interface Utf8Truncation {
  readonly value: string;
  readonly originalBytes: number;
  readonly emittedBytes: number;
  readonly omittedBytes: number;
  readonly truncated: boolean;
}

function isElement(value: unknown): value is Element {
  return (
    typeof value === "object" &&
    value !== null &&
    "nodeType" in value &&
    (value as Node).nodeType === 1 &&
    "tagName" in value
  );
}

function resolveElements(result: ContextRootResult): Element[] {
  const candidates =
    result == null ? [] : isElement(result) ? [result] : result;
  const seen = new Set<Element>();
  const elements: Element[] = [];
  for (const candidate of candidates) {
    if (isElement(candidate) && !seen.has(candidate)) {
      seen.add(candidate);
      elements.push(candidate);
    }
  }
  return elements;
}

function normalizeLimits(
  input: Partial<ContextLimits> | undefined,
): ContextLimits {
  const limits = {
    ...DEFAULT_CONTEXT_LIMITS,
    ...input,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(
        `Context limit ${name} must be a positive safe integer.`,
      );
    }
  }
  return Object.freeze(limits);
}

function normalizePredicates(
  redact: CreatePageContextOptions["redact"],
): readonly ContextRedactionPredicate[] {
  if (redact === undefined) return Object.freeze([]);
  return Object.freeze(Array.isArray(redact) ? [...redact] : [redact]);
}

function normalizeRegionDefinitions(
  regions: CreatePageContextOptions["regions"],
): readonly ContextRegionDefinition[] {
  if (regions === undefined) return Object.freeze([]);
  const definitions = Array.isArray(regions)
    ? [...regions]
    : Object.entries(regions).map(([name, roots]) => ({ name, roots }));
  const seen = new Set<string>();
  return Object.freeze(
    definitions.map((definition) => {
      const name = normalizeRegionName(definition.name);
      if (seen.has(name)) {
        throw new TypeError(`Duplicate configured context region: ${name}`);
      }
      seen.add(name);
      if (typeof definition.roots !== "function") {
        throw new TypeError(
          `Context region ${name} must have a root resolver.`,
        );
      }
      return Object.freeze({ name, roots: definition.roots });
    }),
  );
}

function normalizeRegionName(name: string): string {
  const normalized = name.trim();
  if (normalized.length === 0) {
    throw new TypeError("Context region names must not be empty.");
  }
  return normalized;
}

function isWithinRoots(element: Element, roots: readonly Element[]): boolean {
  return roots.some((root) => root === element || root.contains(element));
}

function isHidden(element: Element): boolean {
  return (
    element.hasAttribute("hidden") ||
    element.getAttribute("aria-hidden")?.toLowerCase() === "true"
  );
}

function redactionKind(
  element: Element,
  state: Pick<RenderState, "predicates" | "redactionDecisions">,
  location: ContextExtractionContext,
): RedactionDecision | false {
  const cached = state.redactionDecisions.get(element);
  if (cached !== undefined) return cached;
  let kind: RedactionDecision | false = false;
  if (element.hasAttribute(REDACT_ATTRIBUTE)) {
    kind = { source: "attribute", reason: "application-redacted" };
  } else if (
    state.predicates.some((predicate) => predicate(element, location))
  ) {
    kind = { source: "predicate", reason: "application-redacted" };
  }
  state.redactionDecisions.set(element, kind);
  return kind;
}

function hasRedactedAncestor(
  element: Element,
  roots: readonly Element[],
  state: Pick<RenderState, "predicates" | "redactionDecisions">,
): boolean {
  let current: Element | null = element;
  let depth = 0;
  while (current !== null) {
    if (
      redactionKind(current, state, {
        rootIndex: 0,
        depth,
        path: "region-resolution",
        regionName: null,
      })
    )
      return true;
    if (roots.includes(current)) return false;
    current = current.parentElement;
    depth += 1;
  }
  return true;
}

function collectAttributeRegions(
  roots: readonly Element[],
  limits: ContextLimits,
  state: Pick<RenderState, "predicates" | "redactionDecisions">,
): readonly RegionRoots[] {
  const regions = new Map<string, Element[]>();
  const visit = (element: Element, depth: number): void => {
    if (
      depth > limits.maxDepth ||
      isHidden(element) ||
      redactionKind(element, state, {
        rootIndex: 0,
        depth,
        path: "region-discovery",
        regionName: null,
      })
    ) {
      return;
    }
    const value = element.getAttribute(REGION_ATTRIBUTE);
    if (value !== null && value.trim().length > 0) {
      const name = value.trim();
      const existing = regions.get(name);
      if (existing === undefined) regions.set(name, [element]);
      else if (!existing.includes(element)) existing.push(element);
    }
    for (const child of element.children) visit(child, depth + 1);
  };
  for (const root of roots) visit(root, 0);
  return [...regions].map(([name, regionRoots]) => ({
    name,
    source: "attribute" as const,
    roots: regionRoots,
  }));
}

function resolveRegions(
  definitions: readonly ContextRegionDefinition[],
  roots: readonly Element[],
  limits: ContextLimits,
  state: Pick<RenderState, "predicates" | "redactionDecisions">,
): { readonly selected: readonly RegionRoots[]; readonly omitted: number } {
  const configured: RegionRoots[] = [];
  const configuredNames = new Set<string>();
  for (const definition of definitions) {
    configuredNames.add(definition.name);
    const regionRoots = resolveElements(definition.roots()).filter(
      (element) =>
        isWithinRoots(element, roots) &&
        !hasRedactedAncestor(element, roots, state),
    );
    if (regionRoots.length > 0) {
      configured.push({
        name: definition.name,
        source: "configured",
        roots: regionRoots,
      });
    }
  }

  const attributed = collectAttributeRegions(roots, limits, state).filter(
    (region) => !configuredNames.has(region.name),
  );
  const all = [...configured, ...attributed];
  return {
    selected: all.slice(0, limits.maxRegions),
    omitted: Math.max(0, all.length - limits.maxRegions),
  };
}

function addRedaction(
  state: RenderState,
  source: ContextRedaction["source"],
  reason: string,
  path: string,
): void {
  const key = `${source}:${reason}:${path}`;
  if (state.redactionKeys.has(key)) return;
  state.redactionKeys.add(key);
  state.redactions.push({ source, reason, path });
}

function structuralChildPath(
  parent: string,
  child: Element,
  index: number,
): string {
  return `${parent}/${child.tagName.toLowerCase()}[${index}]`;
}

function renderChildren(
  element: Element,
  depth: number,
  path: string,
  rootIndex: number,
  state: RenderState,
): string {
  const output: string[] = [];
  let elementIndex = 0;
  for (const child of element.childNodes) {
    if (child.nodeType === 3) {
      output.push(child.nodeValue ?? "");
    } else if (isElement(child)) {
      output.push(
        renderElement(
          child,
          depth + 1,
          structuralChildPath(path, child, elementIndex),
          rootIndex,
          state,
        ),
      );
      elementIndex += 1;
    }
  }
  return output.join(" ");
}

function runExplicitExtractor(
  element: Element,
  context: ContextExtractionContext,
  extractors: readonly ContextExtractorDeclaration[],
): ContextExtractorOutput | null | undefined {
  for (const declaration of extractors) {
    if (typeof declaration === "function") {
      const result = declaration(element, context);
      if (result !== undefined) return normalizeExtractorResult(result);
      continue;
    }
    if ("selector" in declaration && !element.matches(declaration.selector))
      continue;
    if ("matches" in declaration && !declaration.matches(element, context))
      continue;
    const result = declaration.extract(element, context);
    if (result !== undefined) return normalizeExtractorResult(result);
  }
  return undefined;
}

function normalizeExtractorResult(
  result: string | ContextExtractorOutput | null,
): ContextExtractorOutput | null {
  return typeof result === "string" ? { content: result } : result;
}

function sensitiveControlReason(element: Element): string | undefined {
  if (!["INPUT", "SELECT", "TEXTAREA"].includes(element.tagName))
    return undefined;
  const control = element as
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  if (element.tagName === "INPUT") {
    const type = (control as HTMLInputElement).type.toLowerCase();
    if (type === "password") return "password";
    if (type === "file") return "file";
    if (type === "hidden") return "hidden";
    if (SENSITIVE_INPUT_TYPES.has(type)) return type;
  }
  if (SENSITIVE_AUTOCOMPLETE.test(control.autocomplete)) {
    return control.autocomplete.toLowerCase().includes("cc-") ||
      control.autocomplete.toLowerCase().startsWith("transaction-")
      ? "payment"
      : "one-time-code";
  }
  const labels = Array.from(
    control.labels ?? [],
    (label) => label.textContent ?? "",
  );
  const identity = [
    control.name,
    control.id,
    control.autocomplete,
    control.getAttribute("aria-label") ?? "",
    control.getAttribute("placeholder") ?? "",
    ...labels,
  ].join(" ");
  if (!SENSITIVE_CONTROL_NAME.test(identity)) return undefined;
  if (/(?:cc-|payment|credit|card|cvv|cvc|iban|routing)/i.test(identity))
    return "payment";
  if (/(?:otp|one[\s_.:-]*time|passcode|pin)/i.test(identity))
    return "one-time-code";
  return "token-like";
}

function controlLabel(
  element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
): string {
  const labels = Array.from(element.labels ?? [])
    .map((label) => labelText(label, element))
    .filter(Boolean);
  return (
    labels.join(" / ") ||
    normalizeInline(element.getAttribute("aria-label") ?? "") ||
    normalizeInline(element.getAttribute("placeholder") ?? "") ||
    normalizeInline(element.name) ||
    "Unlabelled control"
  );
}

function labelText(label: HTMLLabelElement, control: Element): string {
  const output: string[] = [];
  const visit = (node: Node): void => {
    if (node === control) return;
    if (node.nodeType === 3) output.push(node.nodeValue ?? "");
    else for (const child of node.childNodes) visit(child);
  };
  visit(label);
  return normalizeInline(output.join(" "));
}

function controlValue(
  element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
): string {
  if (element.tagName === "INPUT") {
    const input = element as HTMLInputElement;
    if (input.type === "checkbox" || input.type === "radio") {
      return input.checked ? "checked" : "not checked";
    }
    return input.value;
  }
  if (element.tagName === "SELECT") {
    const select = element as HTMLSelectElement;
    return Array.from(select.selectedOptions)
      .map(
        (option) => normalizeInline(option.textContent ?? "") || option.value,
      )
      .join(", ");
  }
  return element.value;
}

function renderControl(
  element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  path: string,
  state: RenderState,
): string {
  const sensitiveReason = sensitiveControlReason(element);
  if (sensitiveReason !== undefined) {
    addRedaction(state, "sensitive-control", sensitiveReason, path);
    return "";
  }
  const rawValue = controlValue(element);
  const value = truncateUtf8(rawValue, state.limits.maxValueBytes);
  if (value.truncated) {
    state.valueTruncations += 1;
    state.valueOmittedBytes += value.omittedBytes;
  }
  const properties: string[] = [];
  if (element.required) properties.push("required");
  if (element.disabled) properties.push("disabled");
  if ("readOnly" in element && element.readOnly) properties.push("read-only");
  if (element.willValidate && !element.validity.valid)
    properties.push("invalid");
  const suffix = properties.length > 0 ? ` [${properties.join(", ")}]` : "";
  if (
    element.tagName === "INPUT" &&
    (["checkbox", "radio"] as string[]).includes(
      (element as HTMLInputElement).type,
    )
  ) {
    return `\n- [${(element as HTMLInputElement).checked ? "x" : " "}] ${controlLabel(element)}${suffix}\n`;
  }
  return `\n- ${controlLabel(element)}: ${value.value}${suffix}\n`;
}

function renderElement(
  element: Element,
  depth: number,
  path: string,
  rootIndex: number,
  state: RenderState,
): string {
  if (depth > state.limits.maxDepth) {
    state.depthOmissions += 1;
    return DEPTH_MARKER;
  }
  if (isHidden(element) || OMITTED_ELEMENTS.has(element.tagName)) return "";

  const extractionContext: ContextExtractionContext = Object.freeze({
    rootIndex,
    depth,
    path,
    regionName: state.regionName,
    ...(state.regionName === null ? {} : { region: state.regionName }),
  });
  const kind = redactionKind(element, state, extractionContext);
  const isControl = ["INPUT", "SELECT", "TEXTAREA"].includes(element.tagName);
  if (kind && !isControl) {
    addRedaction(state, kind.source, kind.reason, path);
    return "";
  }

  const explicit = runExplicitExtractor(
    element,
    extractionContext,
    state.extractors,
  );
  if (explicit !== undefined) {
    if (explicit === null) return "";
    const children = explicit.includeChildren
      ? renderChildren(element, depth, path, rootIndex, state)
      : "";
    return `${explicit.content}${children}`;
  }

  if (kind) {
    addRedaction(state, kind.source, kind.reason, path);
    return "";
  }

  if (isControl) {
    return renderControl(
      element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
      path,
      state,
    );
  }

  if (element.tagName === "BR") return "\n";
  if (element.tagName === "HR") return "\n\n---\n\n";
  if (element.tagName === "IMG") {
    const alt = normalizeInline((element as HTMLImageElement).alt);
    return alt ? `![${alt}]` : "";
  }

  const children = renderChildren(element, depth, path, rootIndex, state);
  const headingMatch = /^H([1-6])$/.exec(element.tagName);
  if (headingMatch !== null) {
    return `\n\n${"#".repeat(Number(headingMatch[1]))} ${children}\n\n`;
  }
  if (element.tagName === "LI") return `\n- ${children}`;
  if (element.tagName === "PRE")
    return `\n\n\`\`\`\n${children.trim()}\n\`\`\`\n\n`;
  if (element.tagName === "CODE") return `\`${children.trim()}\``;
  if (BLOCK_ELEMENTS.has(element.tagName)) return `\n\n${children}\n\n`;
  return children;
}

function normalizeInline(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeRendered(value: string): string {
  const lines = value.split(/\r?\n/).map((line) => normalizeInline(line));
  const output: string[] = [];
  let blank = false;
  for (const line of lines) {
    if (line.length === 0) {
      if (!blank && output.length > 0) output.push("");
      blank = true;
    } else {
      output.push(line);
      blank = false;
    }
  }
  while (output.at(-1) === "") output.pop();
  return output.join("\n");
}

function truncateUtf8(value: string, limit: number): Utf8Truncation {
  const originalBytes = textEncoder.encode(value).byteLength;
  if (originalBytes <= limit) {
    return {
      value,
      originalBytes,
      emittedBytes: originalBytes,
      omittedBytes: 0,
      truncated: false,
    };
  }

  let bytes = 0;
  let output = "";
  for (const character of value) {
    const characterBytes = textEncoder.encode(character).byteLength;
    if (bytes + characterBytes > limit) break;
    output += character;
    bytes += characterBytes;
  }
  return {
    value: output,
    originalBytes,
    emittedBytes: bytes,
    omittedBytes: originalBytes - bytes,
    truncated: true,
  };
}

function createTruncation(
  limits: ContextLimits,
  rendered: Utf8Truncation,
  depthOmissions: number,
  regionOmissions: number,
  valueTruncations: number,
  valueOmittedBytes: number,
): ContextTruncation {
  const reasons: ContextTruncationReason[] = [];
  if (rendered.truncated) reasons.push("bytes");
  if (depthOmissions > 0) reasons.push("depth");
  if (regionOmissions > 0) reasons.push("regions");
  if (valueTruncations > 0) reasons.push("value");
  return deepFreeze({
    truncated: reasons.length > 0,
    reasons,
    bytes: {
      limit: limits.maxBytes,
      before: rendered.originalBytes,
      after: rendered.emittedBytes,
      omitted: rendered.omittedBytes,
    },
    depth: {
      limit: limits.maxDepth,
      omittedNodes: depthOmissions,
    },
    regions: {
      limit: limits.maxRegions,
      omitted: regionOmissions,
    },
    values: {
      limit: limits.maxValueBytes,
      truncated: valueTruncations,
      omittedBytes: valueOmittedBytes,
    },
  });
}

function renderRoots(
  roots: readonly Element[],
  limits: ContextLimits,
  predicates: readonly ContextRedactionPredicate[],
  extractors: readonly ContextExtractorDeclaration[],
  redactionDecisions: WeakMap<Element, RedactionDecision | false>,
  regionName: string | null,
  regionOmissions = 0,
): RenderedCapture {
  const state: RenderState = {
    limits,
    predicates,
    extractors,
    regionName,
    redactionDecisions,
    redactions: [],
    redactionKeys: new Set(),
    depthOmissions: 0,
    valueTruncations: 0,
    valueOmittedBytes: 0,
  };
  const raw = roots
    .map((root, index) =>
      renderElement(root, 0, `root[${index}]`, index, state),
    )
    .join("\n\n---\n\n");
  const normalized = normalizeRendered(raw);
  const rendered = truncateUtf8(normalized, limits.maxBytes);
  return {
    content: rendered.value,
    redactions: deepFreeze(state.redactions),
    truncation: createTruncation(
      limits,
      rendered,
      state.depthOmissions,
      regionOmissions,
      state.valueTruncations,
      state.valueOmittedBytes,
    ),
  };
}

function regionEquals(left: ContextRegion, right: ContextRegion): boolean {
  return (
    left.name === right.name &&
    left.source === right.source &&
    left.rootCount === right.rootCount &&
    left.content === right.content &&
    JSON.stringify(left.redactions) === JSON.stringify(right.redactions) &&
    JSON.stringify(left.truncation) === JSON.stringify(right.truncation)
  );
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

export function createPageContext(
  options: CreatePageContextOptions,
): PageContext {
  if (typeof options.roots !== "function") {
    throw new TypeError(
      "Page context roots must be supplied as a resolver function.",
    );
  }
  const limits = normalizeLimits(options.limits);
  const predicates = normalizePredicates(options.redact);
  const extractors = Object.freeze([...(options.extractors ?? [])]);
  const definitions = normalizeRegionDefinitions(options.regions);
  const now = options.clock ?? Date.now;
  let revision = 0;

  const capture = (): ContextFrame => {
    const roots = resolveElements(options.roots());
    const redactionDecisions = new WeakMap<
      Element,
      RedactionDecision | false
    >();
    const regionResolution = resolveRegions(definitions, roots, limits, {
      predicates,
      redactionDecisions,
    });
    const full = renderRoots(
      roots,
      limits,
      predicates,
      extractors,
      redactionDecisions,
      null,
      regionResolution.omitted,
    );
    const captured = now();
    const nextRevision = revision + 1;
    const capturedAt = captured instanceof Date ? captured.getTime() : captured;
    const regions = regionResolution.selected.map((region): ContextRegion => {
      const rendered = renderRoots(
        region.roots,
        limits,
        predicates,
        extractors,
        redactionDecisions,
        region.name,
      );
      return deepFreeze({
        revision: nextRevision,
        capturedAt,
        name: region.name,
        source: region.source,
        rootCount: region.roots.length,
        content: rendered.content,
        redactions: rendered.redactions,
        truncation: rendered.truncation,
      });
    });
    const frame = deepFreeze({
      revision: nextRevision,
      capturedAt,
      content: full.content,
      regions,
      redactions: full.redactions,
      truncation: full.truncation,
    });
    revision = nextRevision;
    return frame;
  };

  const listRegions = (
    frame: ContextFrame = capture(),
  ): readonly ContextRegionMetadata[] =>
    deepFreeze(
      frame.regions.map((region) => ({
        name: region.name,
        source: region.source,
        rootCount: region.rootCount,
        contentBytes: textEncoder.encode(region.content).byteLength,
        truncated: region.truncation.truncated,
      })),
    );

  const getRegion = (
    name: string,
    frame: ContextFrame = capture(),
  ): ContextRegion | undefined =>
    frame.regions.find((region) => region.name === name);

  const diff = (
    base: ContextFrame,
    next: ContextFrame = capture(),
  ): ContextFrameDiff => {
    const baseRegions = new Map(
      base.regions.map((region) => [region.name, region]),
    );
    const nextRegions = new Map(
      next.regions.map((region) => [region.name, region]),
    );
    const changedRegions: ContextRegion[] = [];
    const unchangedRegions: string[] = [];
    for (const region of next.regions) {
      const previous = baseRegions.get(region.name);
      if (previous === undefined || !regionEquals(previous, region)) {
        changedRegions.push(region);
      } else {
        unchangedRegions.push(region.name);
      }
    }
    const removedRegions = base.regions
      .filter((region) => !nextRegions.has(region.name))
      .map((region) => region.name);
    return deepFreeze({
      baseRevision: base.revision,
      nextRevision: next.revision,
      contentChanged:
        base.content !== next.content ||
        JSON.stringify(base.redactions) !== JSON.stringify(next.redactions) ||
        JSON.stringify(base.truncation) !== JSON.stringify(next.truncation),
      changedRegions,
      removedRegions,
      unchangedRegions,
    });
  };

  return Object.freeze({
    capture,
    full: capture,
    listRegions,
    getRegion,
    diff,
  });
}
