# Agent Provider visual system

## Direction exploration

### A. Quiet control room — selected

A compact status rail and instrument-like cards put origin, authority, and
provider health first. The layout uses restrained navy/ink surfaces, mineral
green for healthy authority, amber for unresolved risk, and coral only for
destructive actions. Small uppercase labels act as coordinates; large serif
headings are reserved for page identity and decisions.

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

- canvas `#f3f0e8`, surface `#fffdf7`, raised `#ffffff`
- ink `#15231f`, muted `#61706a`, line `#d9ddd5`
- authority `#15745e`, authority-soft `#dff3eb`
- caution `#a25d12`, caution-soft `#fff0d6`
- danger `#b13a4a`, danger-soft `#fde7ea`

Dark:

- canvas `#0d1514`, surface `#121d1b`, raised `#182522`
- ink `#eef5f0`, muted `#9daea8`, line `#2c3b37`
- authority `#62d1ad`, authority-soft `#173b31`
- caution `#f1b765`, caution-soft `#3d2d17`
- danger `#ff8794`, danger-soft `#431f27`

## Interaction rules

- Buttons are rectangular with 8–12 px radii; pills are reserved for compact
  status tags.
- Every control has visible hover and `:focus-visible` treatment.
- Disabled controls retain legible labels and communicate busy state.
- Motion is limited to 120–180 ms color/transform transitions and respects
  `prefers-reduced-motion`.
- Icons, where used, accompany text; no icon is the sole label for an authority
  decision.

## Signature detail

An `AP` relay mark is built from a square seal and a fine horizontal signal
line. It repeats in the popup, approval window, and options rail to make the
trusted extension surface recognizable without decorative gradients.
