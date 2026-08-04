# Claude Usage Notes

## Purpose

Use Claude Code only for repository-aware implementation tasks that require local file editing, running tests, committing, or pushing.

Use ChatGPT for architecture, specifications, code review, and release decisions.

## Cost-control rules

- Give Claude one bounded task at a time.
- Provide exact allowed files and forbidden files.
- Do not ask Claude to explore the whole project unless the task is investigation-only.
- Prefer small commits over long sessions.
- Stop Claude after it produces a result package.
- Review `git diff --stat` before continuing.

## Required Claude prompt pattern

```text
Read docs/AI_ENGINEER.md and docs/specifications/<TASK>.md.
Implement exactly that task.
Do not change forbidden files.
Run npm test.
Create one commit with the specified commit message.
Return the result package requested in the spec.
```
