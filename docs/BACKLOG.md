# Backlog

This file predates the current per-milestone specification process
(`docs/specifications/`) and is not actively maintained per-commit. For current implementation
status, see `docs/ARCHITECTURE.md` (authoritative, updated per milestone) rather than this table.

Every item below was part of the Version 1.0 scope; Version 1.0 is now formally released (`RC-008`,
closed after the `RC-002`–`RC-007` stabilization series and `ARCH-REVIEW-001`'s architecture
review found no open release-blocking defect).

|Priority|Feature|Status|
|---|---|---|
|P0|Curved text|Done (RS-1003)|
|P0|SVG import|Done (RS-1001)|
|P0|Multi-object support|Done (RS-1004)|
|P1|Undo/Redo|Done (RS-1002)|

## Known data defects (not release-blocking, deferred)

|Item|Found by|Notes|
|---|---|---|
|`assets/fonts/Montserrat-Regular.ttf` is Montserrat **Thin**, not Regular|READ-003|The bundled file reports `usWeightClass = 100` (Anton and Great Vibes both report 400). It ships under the `montserrat-regular` id and a "Regular" style label, so anyone picking Montserrat in the font library silently gets a hairline weight — its measured `stemWidthRatio` (0.0145) is the lowest in the library by a wide margin. Independent of readability. The fix is to replace the font file with the true Regular weight, which is a **render-changing migration** for any existing project that uses Montserrat, so it is deferred to its own milestone rather than slipped into an unrelated change.|
