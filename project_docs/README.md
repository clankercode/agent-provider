# Agent Provider project documentation

Agent Provider is a proposed browser-mediated foundation for putting useful AI
agents inside trusted web applications without asking each application to own a
model backend or to handle a user’s model credentials.

It takes its initial direction from the unpacked design materials in
[`draft-designs/unpacked/`](../draft-designs/unpacked/): the more complete
**Sitehand** proof of concept and the earlier **Offsider** exploration. The
names are design-history names, not a decision about the product name.

## Start here

- [Goals and design principles](goals-and-principles.md) explains the outcome
  the project is trying to achieve and the constraints that should shape it.
- [Operating model](operating-model.md) describes the responsibilities and
  lifecycle of the page, extension, provider, tools, and user.
- [User control and audit](user-control-and-audit.md) specifies permission,
  execution modes, and the lifecycle of local audit records.
- [Functional requirements](functional-requirements.md) turns the intended
  behavior into buildable requirements and acceptance criteria.
- [Delivery boundaries](delivery-boundaries.md) records what this project is
  intentionally not trying to be, the trust assumptions it makes, and the
  conditions for a production rollout.

## One-sentence model

The application supplies the agent’s context and typed actions; a browser
extension supplies user-controlled, policy-constrained access to an LLM
provider; the user authorizes both model access and consequential actions.

## Status

Implementation is in progress under the accepted
[implementation plan](../.plan/2026-07-23-quiet-lantern/index.md). These files
remain the canonical product contract; the plan records binding implementation
choices and verification defaults. The supplied designs are historical inputs,
not public compatibility commitments.
