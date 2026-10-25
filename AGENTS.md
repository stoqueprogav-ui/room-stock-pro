# Architecture rules

- Operational loan, debt, and movement screens query only after authentication and room selection are ready; enforce the selected room in the query and discard stale responses to prevent cross-room display during transitions.
- Embedded records returned by row-level-secured queries are nullable; operational screens and loan detail dialogs must render available quantities without dereferencing hidden related records or broadening database permissions.