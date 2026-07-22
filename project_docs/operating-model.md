# Operating model

## Participants and responsibilities

| Participant | Owns | Must not own |
| --- | --- | --- |
| Application page | Agent instructions, conversation UI, typed tools, current app context, and tool callbacks | Provider credentials or unrestricted provider configuration |
| Browser extension | Credential storage, origin grants, alias mapping, request policy, provider networking, and output scrubbing | Application business authorization or direct execution of page callbacks |
| LLM provider | Model inference over the permitted prompt, tools, and prior tool results | Page credentials, arbitrary page HTTP controls, or direct application actions |
| User | Provider setup, origin permission, and approval of consequential actions | Per-app provider plumbing |

## Current-page context

The imported page library includes a context module that converts the
application's current rendered content into model-ready text.  At startup, the
application supplies the normal tool list and may supply a `getContent`-style
function returning the root HTML element for the page's main content, or a list
of such roots.  The library owns the conversion from those elements to bounded
Markdown plus simplified HTML; it does not send DOM nodes across the extension
bridge.

Roots and nested regions can be given stable semantic names, for example with a
dedicated data attribute.  The agent can then obtain a page snapshot, list the
available regions, or request just a named region such as `account-summary`,
`order-history`, or `billing-form`.  The exact public names and data-attribute
format remain an implementation decision, but the capability should be
deliberately narrow and inspectable.

The context module should discover ordinary controls such as forms, labels,
input values, and validation state where this is reliable.  Applications can
override or supplement that behavior with explicit functions for complex forms,
virtualized content, nonstandard widgets, privacy filtering, or domain-specific
summaries.  Automatic extraction is a convenience; explicit application
semantics win whenever they differ.

## Normal lifecycle

1. **Application declaration.** A trusted page registers a small set of typed
   tools, descriptions, schemas, risk levels, and agent instructions.  It also
   optionally registers main-content roots and named regions.  Tool callbacks
   remain ordinary application code.
2. **Bridge discovery and permission.** The page opens a versioned local bridge.
   The extension derives the page origin from browser context, checks that the
   extension was built to run there, and obtains a session or persistent grant
   from the user when needed.  The initial request must be mediated by extension
   UI (toolbar popup, side panel, or an extension-owned prompt), not by page UI
   alone; it identifies the requesting origin, selected alias, and applicable
   execution mode.
3. **Context and model request.** When the agent needs current-page context, it
   uses the page-local context module to obtain a bounded snapshot or named
   region.  The page asks for a configured logical alias and sends a standard,
   bounded model request.  The extension checks permission, alias, request
   size, tool count, concurrency, timeout, and output ceilings before using the
   extension-held credential to call the provider.
4. **Streamed response.** The extension returns only normalized, safe model
   results and stream parts.  It removes raw request/response material,
   headers, provider-specific controls, and credential-like metadata.
5. **Tool loop.** When the model asks to use a tool, the page validates the
   arguments against the tool schema.  Read tools may execute immediately;
   writes and destructive tools pause for user confirmation by default.  The
   application executes the callback and its result becomes part of the next
   model step as needed.
6. **End or failure.** Completion closes the stream.  Navigation, cancellation,
   timeouts, or bridge loss abort pending work and surface an explicit error;
   they do not leave a hidden operation running.

## Execution modes

The user chooses a mode per origin before a run begins; the extension reports
the selected mode to the page runtime as a capability but remains authoritative.

| Mode | Model requests | Tool calls |
| --- | --- | --- |
| Standard | Allowed within origin and alias policy | Application approval defaults apply: reads may run; writes/destructive calls require approval by default |
| Audit first | Each model request is presented for extension approval before provider dispatch | Every proposed tool call is presented for approval before its page callback can run, including reads |
| Private session | Same approval behavior as its base mode | The session is not retained in persistent extension audit storage |

The UI may combine private-session with standard or audit-first behavior.  A
mode change applies only to future requests; it must not silently change the
approval state of an already pending request or tool call.  See
[user control and audit](user-control-and-audit.md) for the user-facing
requirements.

## Operating controls

The extension is the enforcement point for model-access policy.  Its controls
should include exact allowlisted origins, user grants, configured aliases,
provider host allowlists, size/token/concurrency/time limits, cancellation, and
safe result handling.  Page-side filtering is useful defense in depth, but is
not authoritative.

The application is the enforcement point for business safety.  It should expose
narrow tools, verify every action with its existing server-side controls, show
clear approval information, and avoid passing secrets or unnecessary page data
to the model.

## Deployment evolution

An initial internal alpha can use user-managed credentials and explicit origin
grants.  A broader deployment should add managed policy, durable per-origin
request/token/cost budgets, credential rotation/removal, an auditable permission
ledger, robust reconnect/version-compatibility behaviour, and security review
of both the extension and every enabled application origin.
