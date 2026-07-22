# Incident, revocation, and support procedure

## Immediate containment

1. Open Agent Provider settings and revoke the affected exact-origin grant.
2. Cancel visible runs and close affected application tabs.
3. Remove or rotate the provider key in both the extension and provider
   console. Removing a key does not delete provider-side records.
4. Disable the extension if the affected origin or extension build cannot be
   trusted.
5. Preserve metadata-only audit records and browser/extension version details;
   do not copy prompts or secrets into an issue.

## Unknown outcomes

For any request or callback marked `outcome-unknown`, do not retry blindly.
Reconcile using the request/tool idempotency key against provider usage or the
application's own audit/state, then record whether it completed or had no
effect.

## Recovery

- Rebuild with the compromised application origin removed if deployment
  eligibility changed.
- Reconfigure provider profiles and aliases; alias fingerprint changes require
  renewed consent.
- Delete local persistent audit records independently of grant revocation when
  requested.
- Re-enable only after application and extension dependency/security review.

## Reporting

Report the extension version, browser/version, exact origin, safe request IDs,
timestamps, mode, and structured error code. Never include API keys, raw
headers/bodies, prompts, context frames, tool arguments/results, or private
audit data.
