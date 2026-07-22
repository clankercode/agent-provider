# Work queue

This is the repository's lightweight task list while no structured `.tasks`
system is present. New feature, bug, and issue reports are added here before
implementation. If no item is already in progress, work starts with the
highest-priority ready item that is not blocked.

## In progress

- **P1 — Visual review and fix:** finish pixel and source-geometry review of
  the reduced-green extension palette and the settings/model-discovery states.
- **P1 — Release verification:** run the full check and browser suites, update
  release documentation, and commit the completed enhancement slice.

## Completed on 2026-07-23

- **P1 — Provider model discovery:** pull bounded, paginated model catalogs for
  OpenAI-compatible, Anthropic-compatible, and Gemini profiles; keep manual IDs
  as fallback and allow a discovered model to update the default alias.
- **P1 — First-class provider settings:** add OpenAI, Anthropic, and Gemini
  endpoint presets while preserving custom endpoint configuration.
- **P1 — Gateway compatibility:** discover 28 models through both authorized
  gateway API variants and live-test `MiniMax-M2.7-highspeed` generation through
  both OpenAI-compatible and Anthropic-compatible adapters.
- **P1 — Settings save state:** hide the save bar when unchanged, animate dirty
  and saved states, clear the saved receipt automatically, and increase visual
  separation from the page.
- **P2 — Audit rendering:** deduplicate session/persistent events before React
  rendering so mirrored ledger events do not produce duplicate keys.

Longer-term accepted deferrals remain in
[`FUTURE-CONCERNS.md`](FUTURE-CONCERNS.md); they do not become active solely by
appearing there.
