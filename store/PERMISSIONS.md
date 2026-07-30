# Browser permission justifications

## Required extension permissions

- `storage`: keeps provider credentials, exact-origin grants, model aliases,
  durable quota reservations, user settings, and optional bounded audit data in
  extension-local storage.
- `activeTab`: lets the toolbar popup identify the current HTTP(S) origin and
  apply a user decision to that tab without continuously reading all tabs.
- `scripting`: after a user grants one exact optional application origin,
  registers the packaged bridge content script for that origin. It does not
  download or execute remote code.

The extension deliberately does not request the broad `tabs` permission.

## Required host permissions

The manifest names the exact OpenAI, Anthropic, Gemini, and OpenRouter origins
used for provider traffic. Requests are still restricted to the user-selected,
canonical provider profile; redirects and unreviewed endpoint shapes are
rejected.

## Optional host eligibility

`https://*/*` and `http://*/*` are optional eligibility, not active access.
They support user choices that cannot be known when the package is built:

1. enable the packaged bridge on one exact trusted application origin; or
2. connect one exact custom provider endpoint (HTTPS, or HTTP loopback only).

Application bridges may be enabled on any exact HTTPS origin, or on HTTP only
when the host is private/local (loopback, RFC1918, link-local, `.localhost` /
`.local`). Public cleartext HTTP origins are rejected in extension code even
though the optional permission pattern is broad.

The extension calls the browser permission prompt from a direct user gesture
and requests the exact `scheme://host[:port]/*` **host permission**. Content
scripts are registered with a **host-level** match pattern (ports omitted;
browser match patterns are host-based). The background worker still requires
the exact sender origin to be on the user's enabled-origin list before
answering bootstrap. Optional access is inspectable and revocable through the
browser. No broad optional access is activated automatically.
