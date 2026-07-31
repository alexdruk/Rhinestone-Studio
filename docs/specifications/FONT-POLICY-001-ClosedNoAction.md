# FONT-POLICY-001 -- Closed, No Action

Status: **Closed.** Decision: do not pursue raising SS30's height ceiling at this time. No code
changes, no config changes (`SS30.json`, `StoneSizes.js`, `manifest.json`'s
`unsupportedStoneSizes` all remain exactly as FONT-PORTFOLIO-001 left them).

---

## 1. Why this milestone was opened

FONT-PORTFOLIO-001's human ratings collapsed at SS30 for 3 of 4 registered fonts (Anton 6/16,
Sacramento 2/16, Dancing Script 1/16) while Baloo2Variable wght400 held up (15/16). This milestone
audited whether SS30's 106-111mm `supportedHeightRangeMm` ceiling was a real physical limit or an
arbitrary value worth raising. The audit (see the sweep data and reasoning already gathered this
session) found no hard physical wall at 111mm for tumbler/bottle/plate, and a clusterCount/
stoneCount fragmentation-ratio sweep plus genuine stone-dot renders suggested Sacramento and
Dancing Script both recover toward SS20 parity somewhere around 140-170mm. A blind human
rater-tool batch (111mm vs. a 165mm candidate, 4 fonts, 32 items each) was built to validate that
finding before touching any production config.

## 2. What closed it: a second rating pass on the *unchanged* FONT-PORTFOLIO-001 renders

Before validating the new 165mm candidate, a second independent human rating pass was run against
the **exact same FONT-PORTFOLIO-001 rater-tool renders** used in the original collapse finding --
no change to height, font, or any other variable between the two passes.

| Font (SS30) | Pass 1 | Pass 2 |
|---|---|---|
| Sacramento | 2 Readable / 14 Not Sure | 7 Readable / 9 Not Sure |
| Dancing Script | 1 Readable / 14 Not Sure / 1 Unreadable | 4 Readable / 12 Not Sure / 0 Unreadable |
| Anton | 6 Readable / 10 Not Sure | 7 Readable / 9 Not Sure |
| Baloo2Variable (SS10/SS30 control) | 15 Readable / 1 Not Sure | 15 Readable / 1 Not Sure |

Sacramento and Dancing Script's ratings moved substantially between passes on **identical images**
-- Sacramento's Readable count more than tripled (2 -> 7), Dancing Script's quadrupled (1 -> 4).
Anton moved only slightly (6 -> 7) and stayed weak both times. Baloo2Variable was fully stable
across both passes (15/16 both times), showing the rater/methodology is not universally noisy --
only the already-borderline SS30 cases for the three collapsing fonts moved.

## 3. Conclusion

Single-rater test-retest variance at SS30 is large enough that the original "collapse" finding
partly reflects rater-session variability, not a fixed defect that a height-ceiling change would
reliably fix. Chasing a specific new ceiling value (e.g. the 165mm candidate this milestone had
prepared) against a signal this noisy risks tuning to session noise rather than a real defect.

**The already-shipped FONT-PORTFOLIO-001 per-font SS30 gating is the right call and needs no
revision right now**: Anton, Sacramento, and Dancing Script stay gated via `unsupportedStoneSizes`;
Baloo2Variable remains the only font cleared for SS30.

**Exception worth remembering:** Anton's weakness was the most consistent across both passes
(6/16 and 7/16 -- both well below its SS20-equivalent performance, and unlike Sacramento/Dancing
Script, this milestone's own height sweep already showed Anton's fragmentation ratio does not
respond to height at all). If SS30 is revisited, Anton is the one font whose problem looks stable
rather than session-dependent -- and, per this milestone's earlier sweep findings, not a
height-ceiling issue.

## 4. When to revisit

Only if a stronger multi-rater or multi-pass signal emerges showing a specific font's SS30 problem
is **stable, not session-dependent** -- e.g. a multi-rater panel (not single-rater test-retest)
agreeing on the same collapse, or a repeat pass confirming a font stays weak rather than drifting
upward the way Sacramento and Dancing Script did here.

## 5. What exists from this milestone's work, unused

The sweep data, contact-sheet renders, and the 165mm-candidate rater-tool batch built earlier this
session (`tools/font-generator/render_font_policy_001.py`,
`render_font_policy_001_rater_batch.py`, `build_rater_tool_font_policy_001.py`, and
`review/FONT-POLICY-001-rater-*.html`) were removed in RC-009 (file-structure cleanup) to reclaim
space, once their findings were confirmed captured in this document -- none of it was acted on for
a production change, per the decision above, and the SS30 analysis/no-action conclusion recorded
in this document is unaffected.
