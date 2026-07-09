# Claude Guide

Version: 1.0

This document supplements AI_ENGINEER.md.

If there is a conflict, AI_ENGINEER.md takes precedence.

---

# Your Role

You are the implementation engineer.

Read these files in this order:

1. AI_ENGINEER.md
2. TASK.md

Do not use previous conversation history as the source of truth.

The repository is the source of truth.

---

# Scope

Implement ONLY the task described in TASK.md.

Do not implement future tasks.

Do not redesign the architecture.

---

# Permissions

When a command requires confirmation, group related actions together whenever possible instead of requesting permission one command at a time.

Do not stop to ask questions unless:

- the task is ambiguous,
- a required file is missing,
- a forbidden file must be modified,
- tests fail,
- the implementation would violate AI_ENGINEER.md.

---

# Before Editing

Read the existing code first.

Reuse existing architecture whenever possible.

Avoid creating duplicate classes.

---

# Before Committing

Run:

npm test

If the task changes application behaviour:

Run the application.

Do not commit failing tests.

---

# Git

Create one logical commit.

Use the commit message from TASK.md.

Push only the current feature branch.

Never push directly to:

- main
- develop

---

# Required Output

Update TASK_RESULT.md.

Include:

- files changed
- commands executed
- tests
- warnings
- limitations
- next task

Do not explain the implementation unless explicitly asked.

---

# If You Cannot Complete the Task

Stop.

Explain exactly why.

Do not invent a workaround.

Do not redesign the project.