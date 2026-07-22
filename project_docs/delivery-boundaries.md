# Delivery boundaries

## Deliberate non-goals

Agent Provider is not intended to provide:

- general-purpose DOM or arbitrary-website automation;
- a replacement for an application’s authentication, authorization, or audit
  systems;
- a server-side runner for callbacks that belong to an active browser page;
- an operating-system-grade credential vault;
- a generic third-party OAuth or “sign in with a consumer AI product” flow;
- a final implementation of any evolving browser tool standard.

## Trust and data boundary

The extension protects the provider credential from ordinary page JavaScript.
It cannot protect the user from a malicious or compromised script that already
runs on a granted origin: that script can submit prompts and use page-declared
tools subject to the extension’s model-access limits.  For that reason, origin
selection and application security are central product decisions.

Prompts, tool schemas, and tool results needed for the agent loop are sent to
the selected provider under the user’s provider account and data policy.  The
application must disclose this appropriately and minimize sensitive context.

Current-page extraction is likewise an intentional data-disclosure path.  The
context module should extract only configured main-content roots, support
application filtering and section-level access, bound output size, and make it
clear which content was included.  Automatic form detection must not override
an application's redaction or allow sensitive values to become prompt context
merely because they are present in the DOM.

## Production bar

Do not describe the project as production-ready until it has a clearly selected
deployment model and, at minimum:

- a managed-policy or explicitly bounded small-team deployment story;
- durable rate, token, and cost limits per origin;
- credential removal, rotation, and provider revocation guidance;
- compatibility, reconnect, navigation, and cancellation testing;
- a reviewed application threat-model template for tool authors;
- extension/application security review and dependency/update-chain controls;
- an incident, permission-revocation, and support procedure; and
- provider-terms, privacy, and product-name review.

## Decisions still to make

The project still needs explicit decisions on its product name, initial provider
set, supported browsers, policy ownership (user versus administrator), extension
distribution, audit/telemetry retention, credential lifecycle, context snapshot
format/limits, region-tagging convention, form-redaction defaults, and the scope
of browser-standard integration.  The design drafts are useful input to those
decisions; they are not yet the project’s binding specification.
