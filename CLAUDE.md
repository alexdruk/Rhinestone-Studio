# CLAUDE.md

# Rhinestone Studio --- Claude Code Guide

This document is the authoritative guide for Claude Code when working on
Rhinestone Studio.

Read this file before making any changes.

------------------------------------------------------------------------

# Project Overview

Rhinestone Studio is a browser-based application for creating
production-ready rhinestone layouts on physical products such as mugs,
tumblers, bottles, plates, and future product templates.

The application is built around a single geometry pipeline that converts
project data into a deterministic StoneLayout used by every renderer and
exporter.

**Technology**

-   JavaScript (ES Modules)
-   HTML
-   CSS
-   Three.js
-   Canvas 2D

No TypeScript.

------------------------------------------------------------------------

# Primary Goal

Every feature must preserve production correctness.

Rendering exists only to visualize the production layout.

The production layout is the product.

------------------------------------------------------------------------

# Forbidden Changes

Unless explicitly requested, do not:

-   Introduce a second GeometryEngine.
-   Introduce a second StoneLayout pipeline.
-   Generate geometry outside GeometryEngine.
-   Generate stones inside renderers or exporters.
-   Break backward compatibility.
-   Rewrite working subsystems.
-   Add TypeScript.
-   Add frameworks.
-   Duplicate business logic.

------------------------------------------------------------------------

# Core Architecture

Project JSON

↓

GeometryEngine

↓

StoneLayout

↓

Consumers

-   2D Canvas
-   3D Preview
-   SVG Export
-   PNG Export
-   JSON Export
-   Production Sheet

Nothing bypasses this pipeline.

## Geometry

-   Exactly one GeometryEngine.
-   Never create a parallel geometry implementation.
-   All stone generation belongs here.

## StoneLayout

StoneLayout is the universal production representation.

Everything downstream consumes StoneLayout.

Renderers, exporters and products must never generate stones.

## Rendering

Renderers display StoneLayout only.

They must not:

-   generate geometry
-   modify geometry
-   understand project layer types

## Exporters

Exporters consume StoneLayout only.

Never reference:

-   GeometryEngine
-   rendering code
-   project layer types

## Product Definitions

Products define:

-   physical dimensions
-   printable regions
-   production constraints
-   3D profile

Products do not generate rhinestone geometry.

------------------------------------------------------------------------

# Repository Is The Source Of Truth

Never assume a feature is missing.

Always audit the repository before proposing or implementing changes.

If unsure:

Audit first.

Implement second.

------------------------------------------------------------------------

# Repository Layout

    app.js
    index.html

    src/
        export/
        geometry/
        history/
        import/
        library/
        preview3d/
        products/
        renderer/
        svg/
        ui/

    tests/
    tools/
    examples/
    docs/

Reuse existing systems.

Do not create parallel implementations.

------------------------------------------------------------------------

# Development Rules

-   JavaScript only.
-   No TypeScript.
-   Reuse existing helpers.
-   Keep commits focused.
-   Preserve backward compatibility.
-   Prefer the smallest correct solution.
-   Avoid unrelated cleanup.
-   Avoid unnecessary documentation commits.

------------------------------------------------------------------------

# Browser baseline (MAINT-007)

Minimum supported browser is Chrome 103 (the last Chrome available on macOS
Sierra 10.12.6).

Do not use:

-   JSON module imports (the JS import-attributes syntax for importing a
    `.json` file directly). Product definitions are plain `.js` modules with
    a `default` export instead.
-   JS or CSS features newer than Chrome 103, including Set methods such as
    `.union()`/`.intersection()`, CSS nesting, `:has()`, and container
    queries.

`tools/test-browser-baseline.mjs` enforces most of this automatically; it
does not cover every possible newer feature (see
docs/specifications/MAINT-007-BrowserBaseline.md for what it deliberately
does not check, such as Set methods and CSS nesting).

------------------------------------------------------------------------

# UI Principles

Preferred appearance:

-   modern
-   minimal
-   white background
-   deep blue accents

Priorities:

-   discoverability
-   clarity
-   production workflow

------------------------------------------------------------------------

# Product Philosophy

Prefer:

-   production correctness over visual shortcuts
-   data over state
-   reuse over duplication
-   simplicity over cleverness
-   correctness before optimization

------------------------------------------------------------------------

# Testing Policy

During implementation:

Run only tests directly related to the current task.

Do **not** run:

    npm test
    npm run test:full

unless changing shared architecture, project schema, exporters or other
cross-cutting systems.

Shared UI work should include minimal regression checks across supported
products.

------------------------------------------------------------------------

# Browser Testing

Always use an isolated browser instance.

Never:

-   close Chrome
-   quit Chrome
-   close windows named **main**
-   close windows named **airbnb**

Close only the temporary browser instance created for testing.

------------------------------------------------------------------------

# Standard Workflow

1.  Audit
2.  Design
3.  Implement
4.  Focused tests
5.  Browser verification
6.  Commit
7.  Push
8.  Report
9.  Stop

Do not merge.

Do not tag releases.

Do not delete branches.

Those require explicit approval.

------------------------------------------------------------------------

# Example Assets

Avoid adding example assets unless explicitly requested.

------------------------------------------------------------------------

# Before Finishing Any Task

Verify:

-   architecture preserved
-   backward compatibility preserved
-   focused tests pass
-   browser verification completed
-   no unnecessary files added

Then:

-   commit
-   push
-   report
-   stop
