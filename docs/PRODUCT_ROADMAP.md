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

## Versions 1.1.0 to 1.3.0 — released
- 1.1.0 (27 Aug 2026): Design as the primary view, paint regions, shape rotation, units,
  monogram frames. See the release record in `docs/release-process/release-gate.md`.
- 1.2.0 (14 Sep 2026) and 1.3.0 (15 Sep 2026, DXF export, RS-3036).

## Version 2.0.0 — released
- Image → Strass v2 — done (IMG-026, builds A–K): every uploaded photo is redrawn by AI and
  placed by the Python layout service in `services/strass-layout/`, as an ai-layout layer that can
  be edited stone by stone in Design.
- Image → Strass v1 pipeline — done (IMG-000 to IMG-025).
- Flat Sheet object type, large layouts, multi-page Production Sheets — done (RS-3037 to RS-3041).
- Browser baseline Chrome 103 — done (MAINT-007).

The layout service runs on Alex's own computer until a server is rented (IMG-026 decision D5).

## Not yet scheduled
- Product-aware stone count in the redraw prompt (PROMPT_VERSION 7, see `docs/BACKLOG.md`)
- Template library (a working Design Library already exists from RS-1015, currently frozen for
  1.0 per above — re-enabling it is a candidate rather than new work)
- Batch export
- Print layout
