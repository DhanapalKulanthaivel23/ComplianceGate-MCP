# ComplianceGate-MCP Plugin Rules

- Only the 9 dedicated profiles in `VERIFIED_TESTED_PROFILES` (`MT103`, `MT103_STP`, `MT103_REMIT`, `MT202_COV`, `MT205_COV`, `PACS_008`, `PACS_009_COV`, `PACS_004`, `PAIN_001`) may set `isProfileTested: true`.
- All other SWIFT MT and ISO 20022 MX types across the 195 MT and 140 MX catalogue entries must set `isProfileTested: false` and trigger `INSUFFICIENT` + human review.
- Redact PII (`redactSensitiveDataForAgent`) in all MCP tool responses.

