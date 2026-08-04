# QA Template — Internal Commit

Use this checklist for commits that should not visibly change the application.

## Review Goal

This commit changes internal architecture only.

Expected visible change:

```text
None.
```

## 1. Git State

Run:

```bash
git status
```

Expected:

```text
On branch <feature branch>
working tree clean or only expected changed files before commit
```

Result:

- [ ] Pass
- [ ] Fail

Comments:

```text

```

## 2. Automated Tests

Run:

```bash
npm test
```

Expected:

```text
All tests pass.
```

Result:

- [ ] Pass
- [ ] Fail

Comments:

```text

```

## 3. Application Startup

Run:

```bash
npm run dev
```

Open:

```text
http://localhost:5173
```

Expected:

- App opens.
- No browser error page.

Result:

- [ ] Pass
- [ ] Fail

Comments:

```text

```

## 4. Visual Regression Smoke Check

Expected visible change:

```text
None.
```

Question:

Does the app look the same as before this commit?

- [ ] Exactly the same
- [ ] Minor unexpected difference
- [ ] Major unexpected difference
- [ ] App does not start

Comments:

```text

```

## 5. Browser Console

Open browser developer console.

Expected:

```text
No red JavaScript errors.
```

Result:

- [ ] Pass
- [ ] Fail

Comments:

```text

```
