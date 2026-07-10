# Current Task

## Task ID

RS-0003.5B1-SPEC-REVIEW-V2

## Title

Review Corrected Browser Module Migration Specification

## Status

READY FOR SPECIFICATION REVIEW

## Branch

feature/m2-vector-text

## Specification

`docs/specifications/RS-0003.5B1-BrowserMigration.md`

## Objective

Review the corrected specification against the current repository.

Do not implement the migration.

## Allowed Actions

- Read repository files.
- Read process and architecture documents.
- Report conflicts, omissions, risks, and ambiguities.

## Forbidden Actions

- Do not modify files.
- Do not run formatting tools.
- Do not update `TASK_RESULT.md`.
- Do not create a commit.
- Do not push.
- Do not implement any part of RS-0003.5B1.

## Review Questions

1. Does the corrected specification describe the live repository accurately?
2. Does it now account for the three existing forbidden-file guard tests?
3. Does it accurately state that the live app has project export but no project import?
4. Are all required files allowed?
5. Are any required files forbidden?
6. Can the migration preserve all current behavior?
7. Are the automated tests feasible without new dependencies?
8. Is the manual QA complete enough, including layer management?
9. Does the task avoid premature OpenType integration?
10. Is the rollback plan safe?
11. Are the acceptance criteria testable?
12. Is the commit scope small enough for one logical commit?

## Required Result

Return one of:

- `SPECIFICATION APPROVED`
- `CHANGES REQUESTED`

If changes are requested, list each blocking issue with:

- repository evidence,
- why it blocks implementation,
- the exact specification correction recommended.

Do not write code.
