# Agent Provider privacy policy

Last updated: 23 July 2026

Agent Provider is a browser extension that lets a user connect trusted web
applications to an AI provider account chosen and configured by that user.

## Data handled

The extension may handle:

- provider credentials and account-routing fields entered by the user;
- prompt text, bounded page context, declared tool schemas, tool arguments, and
  model responses needed to perform a user-requested agent run;
- exact origins, grants, model aliases, quota counters, approval decisions, and
  metadata-only audit events; and
- extension settings and local error/status information.

Provider credentials, grants, quotas, settings, and audit records are stored in
browser extension-local storage. They are not exposed to ordinary page
JavaScript. Prompt and tool content is not retained in the default audit log.
Persistent metadata audit is off by default, can be enabled separately for an
origin, is bounded by retention limits, and is disabled for private sessions.

## Data sharing and transmission

Agent Provider sends credentials and model requests only to the provider
endpoint the user selected. The selected provider processes that data under its
own terms and privacy policy. A trusted web application receives model output
and tool proposals needed for the active run, but never receives the stored
provider credential from the extension.

The extension has no advertising, analytics, telemetry, data broker, or sale of
personal data. The project operator does not receive extension data unless the
user separately chooses an endpoint operated by that party or includes data in
a support report.

## User controls

Users can revoke an application's grant independently of its audit history,
disable an exact optional site or provider host permission in browser settings,
delete persistent audit for one origin or all origins, remove provider
credentials, or uninstall the extension to remove extension-local data.

## Security and retention

The extension uses exact-origin grants, browser-mediated optional host
permissions, bounded requests and quotas, single-use approvals, and local-only
credential storage. Metadata audit defaults to a maximum of 30 days, 10,000
events, or 10 MiB globally, whichever limit is reached first; users can tighten
these limits.

## Contact

Until a public project support URL is selected, privacy and support requests
must be handled through the distribution account that published the extension.
The published store listing must replace this paragraph with its public support
contact before submission.
