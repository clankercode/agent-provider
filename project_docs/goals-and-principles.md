# Goals and design principles

## Purpose

Agent Provider should make it practical for a trusted web application to offer
an embedded, tool-using AI assistant while keeping the application’s existing
authority model intact. It is aimed first at internal and first-party
applications where the agent can help a user understand current state and carry
out bounded operational work.

The project is not a generic browser automation system. It is a bridge between
an application’s typed capabilities and a user-selected language-model provider.

## Goals

1. **Keep provider credentials out of page code.** The page requests a logical
   model capability; it never receives or stores a provider key.
2. **Keep application actions in the application.** The application defines
   typed tools and executes their callbacks against its existing APIs, UI state,
   and authorization checks.
3. **Fit normal agent tooling.** Model access should look like a conventional
   language-model interface, so applications can use standard agent loops and
   tool schemas instead of a proprietary orchestration stack.
4. **Give the user meaningful control.** Access is explicitly authorized per
   trusted origin, and model choice and limits are governed outside page code.
5. **Make safe work easy.** Read-only actions should be straightforward;
   mutating actions should be visible, typed, and confirmed by default.
6. **Give the agent useful, bounded page context.** An application can identify
   the main content roots for the current page; the page library turns those DOM
   regions into a compact text representation suitable for the agent.
7. **Support gradual adoption.** A page can use a supplied UI or a headless
   runtime, and it may integrate with emerging browser tool standards where
   doing so preserves the same safety properties.

## Principles

### Separate authority from intelligence

The model proposes actions; application tools decide what can actually happen.
Every tool must continue to enforce ordinary server-side authorization,
validation, ownership, idempotency, and business limits. An LLM is not an
authorization system.

### Treat an origin as one trust principal

Browser isolation protects the extension credential boundary, but it does not
distinguish scripts within a granted origin. Granting an origin therefore means
trusting all script that can run there. Narrow origins, strong CSP/XSS hygiene,
and third-party-script governance are prerequisites, not optional polish.

### Centralize provider policy

The page should request a stable alias such as `default` or `reasoning`, not an
arbitrary provider model, HTTP header, or provider-specific option. The
extension maps aliases to user or administrator policy: provider, model,
output/reasoning ceilings, timeouts, and other limits.

### Fail closed at boundaries

If permission is absent, the bridge disconnects, a request times out, or data
cannot be safely serialized, no model call or tool callback should silently
continue. Raw provider transport details and credential-like metadata do not
belong in page-visible results.

### Keep interfaces small and versioned

The page-to-extension protocol should carry only the information needed for a
standard model call: a versioned envelope, a logical alias, conservative call
options, and scrubbed generated results. Credentials, extension settings, and
provider-specific controls remain outside that protocol.

### Prefer explicitness for side effects

Tools are classified at least as `read`, `write`, or `destructive`. Writes and
destructive operations require an app-native user confirmation by default.
Confirmation improves operational safety, but it does not replace application
authorization or turn an untrusted page into a trusted one.

### Expose semantic context, not an unrestricted DOM

Page context belongs behind one deep **context module**. Its small interface
should let an application provide the current main-content element (or a short
list of them), optionally label meaningful subregions, and obtain a text
snapshot or a named section. Its implementation can handle DOM traversal,
Markdown/simplified-HTML rendering, form discovery, filtering, truncation, and
refreshing. This gives applications leverage without requiring each one to
recreate a brittle DOM-to-prompt pipeline.

Automatic detection is a useful default—especially for ordinary forms and
standard main-content layouts—but it is advisory. Applications must be able to
provide roots and explicit extractor functions when their semantics, privacy
requirements, or UI structure need more precision.
