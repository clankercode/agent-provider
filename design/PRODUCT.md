# Agent Provider product frame

## Product mode

Product application: a browser authority console, not a marketing site. The
extension is the trusted surface between an application origin and a user's
model-provider credentials.

## Primary jobs

1. Understand which origin is asking for access and what authority it receives.
2. Grant tab-only or persistent access, and revoke it without ambiguity.
3. Configure provider profiles and logical model aliases without exposing keys
   to page JavaScript.
4. Review consequential approvals and explain why a request was blocked.
5. Keep policy, quota, audit, and browser-support status inspectable.

## Users and posture

The primary user is a developer or technical operator. The interface should
feel precise, calm, and security-conscious. It must never imply that a page is
trusted merely because it requested access.

## Required surfaces

- Toolbar popup: current origin, provider readiness, grant/revoke action, and a
  clear path to settings.
- Extension-owned approval window: requested origin, alias/mode, authority,
  duration, and an explicit allow/deny choice.
- Options console: provider profiles, aliases, policies, and revocation/audit
  controls.
- Reference application: realistic account operations with read, write,
  destructive, named-region, and form-context examples.

## Success criteria

- The origin and authority dominate every consent decision.
- Primary and destructive actions cannot be confused by color, copy, or order.
- Loading, empty, denied, expired, disconnected, invalid, and saved states are
  designed rather than incidental.
- Light and dark themes maintain readable contrast and the same information
  hierarchy.
- Popup works at 360 px; options and sample work from 360 px through desktop.
