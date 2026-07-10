# Commit Package Standard

Every Rhinestone Studio commit package must describe exactly what changed, what should not change, and what the reviewer should verify.

## Required Review Header

Each package must begin with this short summary:

```text
This commit changes: <one sentence>
Please verify: <one sentence>
Expected visible change: <none / specific UI behavior>
Risk level: <low / medium / high>
```

## Required Sections

Every package must include:

1. **Purpose** — why this commit exists.
2. **Files changed** — exact file list.
3. **What should change** — user-visible or internal behavior.
4. **What should not change** — regression expectations.
5. **How to apply** — exact terminal commands.
6. **How to test** — exact commands and expected output.
7. **QA checklist** — internal or feature checklist.
8. **Commit command** — exact Git command and commit message.
9. **Known risks** — anything that may need extra attention.

## Commit Package Types

### Internal package

Internal packages add architecture, data models, utilities, tests, or documentation.

Expected visible change is usually:

```text
None.
```

QA focuses on:

- tests pass;
- app starts;
- no console errors;
- visible behavior unchanged.

### Feature package

Feature packages change the UI, renderer, geometry output, exports, or user workflow.

QA must include concrete actions, expected results, multiple-choice ratings, and space for comments.

## Rule

If the reviewer cannot tell what to check within 30 seconds, the package is incomplete.
