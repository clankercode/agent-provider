# Plan review 3

Verdict: FAIL

The slower independent review found seven deterministic-contract gaps after the
earlier gate: Firefox match-pattern ports, endpoint canonicalization, approval
record binding, alias fingerprint contents, cancellation terminal vocabulary,
exact v0 bootstrap schemas, and release-grade source provenance.

All are accepted. The specification now defines browser-specific manifest
coverage versus exact runtime origin authority, a WHATWG URL algorithm, complete
immutable approval/fingerprint hashes, explicit state transitions, concrete v0
Hello/Ready/Reject schemas, and a rightsholder/source-snapshot inventory.

Remaining uncertainty: executable tests must prove these contracts.
