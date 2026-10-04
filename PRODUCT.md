# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Meeting participants tracking commitments and decisions, including people who cannot
speak or type. Hackathon judges evaluate a working enterprise workflow.

## Product Purpose

Grovekeeper turns live meeting commitments into a living forest of traceable seeds.
Participants review owners, deadlines, source context, progress, and health.

## Operating Context

React/Vite/TypeScript browser app with Azure Functions and shared storage owned by
Person A. Person C owns forest UI and seed health; B owns input tracking; D owns
Whispering Leaves. The current backend is a memory scaffold, not live Cosmos.

## Capabilities and Constraints

Features consume one input bus for mouse, hand, and head controls. Source provenance
is immutable. Camera processing stays local. Speech requires explicit confirmation.
Seven-day inactivity decay is the base health rule. Deadline acceleration remains
undecided. For this implementation, bloom is treated as completed and immune to decay;
this is an implementation assumption to confirm with the team.

## Brand Commitments

Grovekeeper; Enchanted Grove hackathon theme. Seeds, roots, sprouting, blooming, and
wilting convey commitments, relationships, progress, completion, and neglected tasks.

## Evidence on Hand

Team architecture supplied in conversation, ADP challenge PDF, README.md, docs/api.md,
and fictional fixtures in web/src/api/fixtures.ts. No live customer claims or metrics.

## Product Principles

- Actions remain traceable to their source.
- Saved state is distinguished from unsaved changes and demo data.
- All input methods reach the same actions.
- Feature owners integrate through shared contracts.

## Accessibility & Inclusion

Keyboard and mouse remain available alongside head and hand input. Controls need
clear focus, readable labels, large targets, and reduced-motion support. State must
be conveyed by text and shape as well as color.

## Open Surface Decision

The initial view is provisionally a spatial garden with a details panel, based on the
team architecture. The question has been offered to the user; no additional audience
or product facts are inferred from silence.
