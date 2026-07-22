# Agent Provider visual system

## Direction exploration

### A. Quiet control room — selected

A compact status rail and instrument-like cards put origin, authority, and
provider health first. The layout uses restrained blue-charcoal/ink surfaces,
cobalt for extension authority, green only for confirmed health, amber for
unresolved risk, and coral only for destructive actions. Small uppercase labels
act as coordinates; large serif headings are reserved for page identity and
decisions.

### B. Credential vault

A centered vault-card layout would make credentials feel protected, with
provider profiles arranged as locked drawers. It is distinctive but weakens the
relationship between origin, model alias, policy, and audit state.

### C. Relay ledger

A chronological ledger would treat every model request as an append-only event
with approvals inline. It is excellent for audit review but too dense for first
run and routine provider configuration.

Direction A best serves the primary job: make current authority legible before
the user acts. The ledger pattern may be reused inside a future audit screen.

## Model discovery structure

### A. Inline profile catalog — selected

Each profile owns its pull action, loading/error receipt, model selector, and
“use for default alias” action. It keeps credentials, endpoint, catalog, and
model choice in one authority boundary and makes custom-provider failures easy
to attribute.

### B. Global model inventory

A cross-provider table would improve comparison, but it obscures which endpoint
and credential produced each row and creates unnecessary first-run density.

### C. Alias-first picker

Putting discovery only in the alias editor would shorten the profile cards, but
it would make endpoint troubleshooting indirect and leave profiles without a
clear connection test.

The inline catalog wins because model discovery is a provider capability first
and an alias convenience second. Catalogs are ephemeral and manually refreshed;
manual identifiers remain the compatibility escape hatch.

## Structural rules

- Popup: brand/status header, high-salience origin plate, two-column health
  strip, one decision cluster, settings footer.
- Approval: asymmetric two-column decision card. The origin and authority
  summary occupy the broad column; duration and actions form a narrow rail.
- Options: persistent left navigation/status rail and a broad configuration
  canvas. On narrow screens the rail becomes a compact header.
- Sample: business dashboard remains primary; the agent is a distinct right
  rail or floating panel, never a generic full-page chat app.

## Type

- Display: Georgia, `Iowan Old Style`, serif. Used sparingly for decisions and
  top-level titles.
- UI: Inter-compatible system sans stack.
- Data: `ui-monospace`, SFMono-Regular, Consolas, monospace.

## Tokens

Light:

- canvas `#f4f1ea`, surface `#fffdf8`, raised `#ffffff`
- ink `#202633`, muted `#6b7280`, line `#d8d9dc`
- authority `#3457a1`, authority-soft `#e8edfa`
- caution `#a25d12`, caution-soft `#fff0d6`
- danger `#b13a4a`, danger-soft `#fde7ea`

Dark:

- canvas `#0d1118`, surface `#131923`, raised `#1a2230`
- ink `#f0f2f6`, muted `#a3acba`, line `#303949`
- authority `#93afff`, authority-soft `#202e54`
- caution `#f1b765`, caution-soft `#3d2d17`
- danger `#ff8794`, danger-soft `#431f27`

## Interaction rules

- Buttons are rectangular with 8–12 px radii; pills are reserved for compact
  status tags.
- Every control has visible hover and `:focus-visible` treatment.
- Disabled controls retain legible labels and communicate busy state.
- Motion is limited to 120–180 ms color/transform transitions and respects
  `prefers-reduced-motion`.
- The save bar is absent when settings match the saved snapshot. Dirty, saving,
  saved, and failed states enter from below the viewport; a saved receipt exits
  after 2.4 seconds.
- Icons, where used, accompany text; no icon is the sole label for an authority
  decision.

## Signature detail

An `AP` relay mark is built from a square seal and a fine horizontal signal
line. It repeats in the popup, approval window, and options rail to make the
trusted extension surface recognizable without decorative gradients.
