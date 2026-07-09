# Rhinestone Studio Review Checklist

Version: 1.0

---

# Purpose

This checklist is used before every merge into `develop`.

Passing automated tests is necessary but not sufficient.

Every implementation must also pass architecture review and human QA.

---

# Review Outcome

One of:

- APPROVED
- CHANGES REQUESTED
- REJECTED

Record the outcome in the pull request or task review.

---

# 1. Scope Review

Does the implementation match TASK.md?

- [ ] Yes
- [ ] No

Were unrelated files modified?

- [ ] No
- [ ] Yes

If yes, explain why.

---

# 2. Architecture Review

Does the implementation follow ARCHITECTURE.md?

- [ ] Geometry Engine remains the single source of truth.
- [ ] Renderer contains no geometry generation.
- [ ] Exporters contain no geometry generation.
- [ ] Validation does not modify data.
- [ ] No duplicated business logic.
- [ ] Internal units remain millimeters.
- [ ] No architecture violations.

Comments

______________________________

---

# 3. Code Quality

- [ ] Code is readable.
- [ ] No unnecessary complexity.
- [ ] No obvious duplication.
- [ ] Public API is documented.
- [ ] Error handling is appropriate.
- [ ] No unexplained magic constants.

Comments

______________________________

---

# 4. Testing

Required

- [ ] npm test passes.

If applicable

- [ ] npm run build passes.
- [ ] Application starts.
- [ ] No browser console errors.

Comments

______________________________

---

# 5. Human QA

Expected visible change matches TASK.md.

Examples

- text quality improved
- cup preview unchanged
- export still works

Result

- [ ] PASS
- [ ] FAIL

Comments

______________________________

---

# 6. Regression Review

Verify that unrelated functionality still works.

Examples

- [ ] Existing text still renders.
- [ ] Existing projects still open.
- [ ] Export still works.
- [ ] Production Layout still matches Cup Preview.
- [ ] No new warnings.

Comments

______________________________

---

# 7. Documentation

- [ ] TASK_RESULT.md completed.
- [ ] Public API documented.
- [ ] Architecture documentation updated if required.
- [ ] README updated if necessary.

Comments

______________________________

---

# 8. Git Review

- [ ] One logical commit.
- [ ] Commit message follows Conventional Commits.
- [ ] Feature branch only.
- [ ] No accidental files committed.
- [ ] package-lock.json included when dependencies changed.

Comments

______________________________

---

# 9. Decision

Result

- [ ] APPROVED
- [ ] CHANGES REQUESTED
- [ ] REJECTED

Reason

__________________________________________________

__________________________________________________

---

# 10. Next Task

Recommended next milestone

_____________________________________

Estimated risk

- LOW
- MEDIUM
- HIGH

Estimated effort

_____________________________________