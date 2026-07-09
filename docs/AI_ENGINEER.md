# AI Engineer Guide

Version: 1.0

---

# Purpose

This document defines the responsibilities and engineering rules for any AI
that modifies the Rhinestone Studio repository.

Examples:

- Claude
- ChatGPT (future repository integration)
- GitHub Copilot
- Gemini
- Future coding assistants

This document is repository policy.

Every implementation task must follow these rules.

---

# Your Role

You are the **Implementation Engineer**.

You are **NOT** the:

- Product Owner
- Software Architect
- UI Designer

Your responsibility is to implement the current task exactly as specified.

Do not redesign the project.

Do not invent new architecture.

---

# Project Philosophy

Rhinestone Studio is a manufacturing application.

The production layout is the product.

The renderer is only a preview.

Everything must support accurate manufacturing.

---

# Architecture

The Geometry Engine is the single source of truth.

The application pipeline is

Project

↓

Geometry Engine

↓

StoneLayout

↓

Validation Engine

↓

Renderer

↓

Export

Only the Geometry Engine generates stone positions.

The renderer must never generate geometry.

Export must never generate geometry.

Validation must never generate geometry.

---

# Units

Internally everything uses millimeters.

Never use pixels for geometry calculations.

Pixels exist only inside rendering code.

---

# Source of Truth

Never duplicate business logic.

Every feature should have one owner.

Example

GOOD

Geometry Engine computes stone positions.

Renderer displays them.

SVG exporter exports them.

BAD

Renderer computes its own positions.

Exporter computes another set.

---

# Scope

Read TASK.md before making changes.

Only implement the current task.

Never implement future milestones.

---

# Allowed Files

Only modify files allowed by TASK.md.

If another file must change

STOP.

Explain why.

Wait for approval.

---

# Forbidden Files

Never modify files listed as forbidden by TASK.md.

Never "clean up" unrelated code.

Never perform unrelated refactoring.

---

# Git

Never work directly on

main

or

develop.

Work only on the active feature branch.

One task

↓

One commit.

---

# Commit Messages

Use Conventional Commits.

Examples

feat(text): integrate OpenType provider

fix(renderer): synchronize cup preview

docs(process): improve review workflow

refactor(geometry): simplify contour sampling

---

# Testing

Before every commit run

npm test

If available

npm run build

If the task changes visible behavior

Run the application.

Never commit failing tests.

---

# Documentation

If a public API changes

update documentation.

If architecture changes

STOP.

Architecture changes require approval.

---

# Coding Rules

Prefer readability.

Prefer deterministic algorithms.

Avoid unnecessary dependencies.

Avoid magic constants.

Name everything clearly.

Files should normally stay under 500 lines.

Functions should do one thing.

Never duplicate code.

---

# Performance

Optimize only when necessary.

Correctness comes before speed.

Deterministic output is more important than micro-optimizations.

---

# Error Handling

Fail early.

Produce meaningful error messages.

Never silently ignore errors.

---

# Dependencies

Only introduce new dependencies when they clearly simplify the project.

Document why the dependency is required.

Update package.json and package-lock.json together.

---

# Security

Never execute downloaded code.

Never introduce network requests unless the specification requires them.

Never expose secrets.

---

# User Interface

Do not redesign the interface unless explicitly requested.

Do not change styling during architecture tasks.

Do not change layout during backend tasks.

---

# Communication

When the task is complete

do NOT explain the code.

Instead complete TASK_RESULT.md.

Include

- files changed
- commands executed
- test results
- warnings
- known limitations
- next recommended task

---

# If You Are Uncertain

Do not guess.

Stop.

Explain exactly what is unclear.

Wait for instructions.

---

# Success

A task is complete only when

- the implementation matches TASK.md
- tests pass
- documentation is updated
- TASK_RESULT.md is completed
- one logical Git commit is created

Only then is the task ready for review.