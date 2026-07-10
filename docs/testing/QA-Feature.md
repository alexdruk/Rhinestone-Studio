# QA Template — Feature Commit

Use this checklist for commits that intentionally change visible behavior.

## Review Goal

This commit changes:

```text
<describe user-visible change>
```

## 1. Automated Tests

Run:

```bash
npm test
```

Result:

- [ ] Pass
- [ ] Fail

Comments:

```text

```

## 2. Application Startup

Run:

```bash
npm run dev
```

Open:

```text
http://localhost:5173
```

Result:

- [ ] Pass
- [ ] Fail

Comments:

```text

```

## 3. Primary Feature Test

Steps:

1. <step>
2. <step>
3. <step>

Expected:

```text
<expected result>
```

Rating:

- [ ] Excellent
- [ ] Good
- [ ] Acceptable
- [ ] Poor
- [ ] Broken

Comments:

```text

```

## 4. Synchronization Test

Change a relevant parameter.

Expected:

- 2D layout updates.
- 3D preview updates when applicable.
- Exports use the same generated layout.

Result:

- [ ] All synchronized
- [ ] 2D only updated
- [ ] 3D only updated
- [ ] Export mismatch
- [ ] Broken

Comments:

```text

```

## 5. Regression Check

Verify unrelated features still work.

- [ ] Existing app loads
- [ ] Existing controls still respond
- [ ] Existing tests pass
- [ ] No new console errors

Comments:

```text

```
