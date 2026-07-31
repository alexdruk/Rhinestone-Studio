# Product Roadmap

This file predates the current per-milestone specification process
(`docs/specifications/`) and is not actively maintained per-commit. For current implementation
status, see `docs/ARCHITECTURE.md` (authoritative, updated per milestone) rather than this file.

## Version 1.0 — released (RC-008)
- Curved text — done (RS-1003)
- SVG import — done (RS-1001)
- Multi-object support — done (RS-1004)
- Undo/Redo — done (RS-1002)

Version 1.0 is formally released, closed by `RC-008` after an audit-first review of the `RC-002`
→ `RC-007` stabilization series and `ARCH-REVIEW-001`'s full architecture/codebase review found no
open release-blocking defect (100% of the full test suite passing). Gallery (RS-2001) and Design
Library (RS-1015) were both built but remain disabled in the UI for this release (`S-103`,
`RC-006`) — the code and any existing saved data remain intact, unaffected by the freeze that
preceded closure.

## Version 1.1 — not started
- Template library (a working Design Library already exists from RS-1015, currently frozen for
  1.0 per above — re-enabling it is a candidate rather than new work)
- Batch export
- Print layout
