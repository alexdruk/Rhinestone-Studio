# Rhinestone Studio — Milestone Review Checklist

## Review Inputs

The reviewer should receive:

- milestone specification,
- `TASK_RESULT.md`,
- commit hash,
- commit summary,
- changed-file list,
- automated test result,
- browser/manual verification result,
- warnings and known limitations.

A full diff is requested only when needed.

---

## 1. Milestone Outcome

- [ ] The milestone's required outcome is complete.
- [ ] Visible behavior matches the specification.
- [ ] No required behavior is merely described but not implemented.
- [ ] The implementation did not begin the next milestone.

---

## 2. Architecture

- [ ] The geometry model remains the source of truth.
- [ ] Production geometry remains in millimeters.
- [ ] UI and rendering do not own permanent geometry.
- [ ] Text, geometry, rendering, and exporting responsibilities remain separated.
- [ ] No unnecessary parallel implementation was introduced.
- [ ] New dependencies or adapters are justified.

---

## 3. Scope

- [ ] Changed files match the allowed scope.
- [ ] Forbidden files were not modified.
- [ ] Unrelated cleanup was avoided.
- [ ] Existing APIs were not changed without need.
- [ ] Documentation matches the implemented state.

---

## 4. Tests

- [ ] All existing tests pass.
- [ ] New behavior has meaningful tests.
- [ ] Tests verify behavior or architecture rather than fragile formatting.
- [ ] Browser/module work includes real browser verification when possible.
- [ ] Manual checks are clearly distinguished from automated checks.
- [ ] Unverified behavior is not presented as passing.

---

## 5. User-Visible Quality

When the milestone affects the application:

- [ ] Default project loads.
- [ ] Text remains readable.
- [ ] 2D layout remains usable.
- [ ] 3D preview remains usable.
- [ ] Shapes and layers remain operable.
- [ ] Exports remain operable.
- [ ] No relevant console error occurs.
- [ ] Expected visible changes are present.
- [ ] Unexpected visible regressions are absent.

---

## 6. Delivery Quality

- [ ] `TASK_RESULT.md` is complete and honest.
- [ ] Commit is focused.
- [ ] Commit message is appropriate.
- [ ] Branch was pushed.
- [ ] Known limitations are acceptable.
- [ ] Follow-up work is clearly separated.

---

## Review Decision

Use exactly one:

### APPROVED

The milestone satisfies its acceptance criteria and is ready to merge.

### APPROVED WITH MINOR COMMENTS

The milestone is ready to merge. Comments are non-blocking and should be considered in later work.

### CHANGES REQUESTED

The milestone must not merge until the listed blocking issues are corrected.

For `CHANGES REQUESTED`, identify:

- the blocking issue,
- the affected requirement,
- the smallest acceptable correction,
- the required regression test.