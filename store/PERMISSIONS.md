# Browser permission justifications

## Required extension permissions

- `storage`: keeps provider credentials, exact-origin grants, model aliases,
  durable quota reservations, user settings, and optional bounded audit data in
  extension-local storage.
- `activeTab`: lets the toolbar popup identify the current HTTP(S) origin and
  apply a user decision to that tab without continuously reading all tabs.
- `scripting`: after a user grants one exact optional HTTPS origin, registers
  the packaged bridge content script for that origin. It does not download or
  execute remote code.

The extension deliberately does not request the broad `tabs` permission.

## Required host permissions

The manifest names the exact OpenAI, Anthropic, Gemini, and Amaroo Labs gateway
origins used for provider traffic. Requests are still restricted to the
user-selected, canonical provider profile; redirects and unreviewed endpoint
shapes are rejected.

## Optional HTTPS eligibility

`https://*/*` is optional eligibility, not active access. It supports two user
choices that cannot be known when the package is built:

1. enable the packaged bridge on one exact trusted application origin; or
2. connect one exact custom provider endpoint.

The extension calls the browser permission prompt from a direct user gesture,
requests the exact `scheme://host[:port]/*` pattern, and registers only the
packaged content script for that exact application origin. Optional access is
inspectable and revocable through the browser. No broad optional access is
activated automatically.
