export const DEFAULT_CONTEXT_LIMITS = Object.freeze({
  maxBytes: 32 * 1024,
  maxDepth: 32,
  maxRegions: 128,
  maxValueBytes: 4 * 1024,
});

export interface ContextLimits {
  /** Maximum UTF-8 bytes in a rendered full snapshot or named region. */
  readonly maxBytes: number;
  /** Maximum element nesting below each capture root. The root is depth zero. */
  readonly maxDepth: number;
  /** Maximum number of distinct named regions in a frame. */
  readonly maxRegions: number;
  /** Maximum UTF-8 bytes emitted for one automatically discovered form value. */
  readonly maxValueBytes: number;
}

export type ContextRootResult =
  Element | readonly Element[] | Iterable<Element> | null | undefined;

/** Resolved for every capture; DOM nodes are never retained in a frame. */
export type ContextRootResolver = () => ContextRootResult;

export interface ContextRegionDefinition {
  readonly name: string;
  /** Resolved at the same capture boundary as the main roots. */
  readonly roots: ContextRootResolver;
}

export type ContextRegionConfiguration =
  | readonly ContextRegionDefinition[]
  | Readonly<Record<string, ContextRootResolver>>;

export interface ContextExtractionContext {
  readonly rootIndex: number;
  readonly depth: number;
  readonly path: string;
  readonly regionName: string | null;
  readonly region?: string;
}

export interface ContextExtractorOutput {
  readonly content: string;
  /** Continue with the element's children after the explicit content. */
  readonly includeChildren?: boolean;
}

export type ContextExtractorResult =
  string | ContextExtractorOutput | null | undefined;

export type ContextExtractorFunction = (
  element: Element,
  context: ContextExtractionContext,
) => ContextExtractorResult;

export interface ContextSelectorExtractor {
  readonly name?: string;
  readonly selector: string;
  readonly extract: ContextExtractorFunction;
}

export interface ContextPredicateExtractor {
  readonly name?: string;
  readonly matches: (
    element: Element,
    context: ContextExtractionContext,
  ) => boolean;
  readonly extract: ContextExtractorFunction;
}

export type ContextExtractor =
  | ContextExtractorFunction
  | ContextSelectorExtractor
  | ContextPredicateExtractor;

export type ContextExtractorDeclaration = ContextExtractor;

export type ContextRedactionPredicate = (
  element: Element,
  context: ContextExtractionContext,
) => boolean;

export interface CreatePageContextOptions {
  /** Main-content roots, resolved anew at every capture boundary. */
  readonly roots: ContextRootResolver;
  /** Configured regions take precedence over matching data attributes. */
  readonly regions?: ContextRegionConfiguration;
  /** Application predicates run before explicit or automatic extraction. */
  readonly redact?:
    ContextRedactionPredicate | readonly ContextRedactionPredicate[];
  /** Explicit extraction runs before ordinary DOM and form extraction. */
  readonly extractors?: readonly ContextExtractor[];
  readonly limits?: Partial<ContextLimits>;
  /** Injectable capture clock. It must return epoch milliseconds or a Date. */
  readonly clock?: () => number | Date;
}

export type PageContextOptions = CreatePageContextOptions;

export type ContextRedactionSource =
  "attribute" | "predicate" | "sensitive-control";

export interface AppliedContextRedaction {
  readonly source: ContextRedactionSource;
  readonly reason: string;
  /** Structural path only; identifiers and field names are intentionally absent. */
  readonly path: string;
}

export type ContextRedaction = AppliedContextRedaction;

export type ContextTruncationReason = "bytes" | "depth" | "regions" | "value";

export interface ContextTruncation {
  readonly truncated: boolean;
  readonly reasons: readonly ContextTruncationReason[];
  readonly bytes: {
    readonly limit: number;
    readonly before: number;
    readonly after: number;
    readonly omitted: number;
  };
  readonly depth: {
    readonly limit: number;
    readonly omittedNodes: number;
  };
  readonly regions: {
    readonly limit: number;
    readonly omitted: number;
  };
  readonly values: {
    readonly limit: number;
    readonly truncated: number;
    readonly omittedBytes: number;
  };
}

export type ContextRegionSource = "configured" | "attribute";

export interface ContextRegion {
  readonly revision: number;
  readonly capturedAt: number;
  readonly name: string;
  readonly source: ContextRegionSource;
  readonly rootCount: number;
  readonly content: string;
  readonly redactions: readonly ContextRedaction[];
  readonly truncation: ContextTruncation;
}

export interface ContextRegionMetadata {
  readonly name: string;
  readonly source: ContextRegionSource;
  readonly rootCount: number;
  readonly contentBytes: number;
  readonly truncated: boolean;
}

export interface ContextFrame {
  readonly revision: number;
  readonly capturedAt: number;
  readonly content: string;
  readonly regions: readonly ContextRegion[];
  readonly redactions: readonly ContextRedaction[];
  readonly truncation: ContextTruncation;
}

export interface ContextFrameDiff {
  readonly baseRevision: number;
  readonly nextRevision: number;
  readonly contentChanged: boolean;
  readonly changedRegions: readonly ContextRegion[];
  readonly removedRegions: readonly string[];
  readonly unchangedRegions: readonly string[];
}

export interface PageContext {
  /** Capture all currently configured roots into one immutable frame. */
  capture(): ContextFrame;
  /** Explicit full-snapshot spelling for lazy context-tool integrations. */
  full(): ContextFrame;
  /** List region metadata. Without a frame, captures current DOM first. */
  listRegions(frame?: ContextFrame): readonly ContextRegionMetadata[];
  /** Get a named region. Without a frame, captures current DOM first. */
  getRegion(name: string, frame?: ContextFrame): ContextRegion | undefined;
  /** Compare with a supplied frame. Without next, captures current DOM first. */
  diff(base: ContextFrame, next?: ContextFrame): ContextFrameDiff;
}
