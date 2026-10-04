# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Client-account teams tracking commitments and decisions across online meetings,
Slack, and pasted or uploaded email/chat/documents. Whispering Leaves supports
participants composing speech with mouse and keyboard.

## Product Purpose

Grovekeeper is pivoting to a grove per client account, fed by multiple context sources.
Participants review owners, deadlines, source context, progress, and health.

## Operating Context

React/Vite/TypeScript browser app with Azure Functions and shared storage owned by
Person A. Person C owns forest UI and seed health; Person D owns
Whispering Leaves. Person A's shared backend supports Cosmos and explicit local memory.
Person B now owns ingestion and Slack. The input-tracking branch is not part of the
new product. Shared account types/storage and the account dashboard are integrated;
meeting partitions remain the storage key.

## Capabilities and Constraints

Leaves uses native mouse/keyboard controls. Hand/head tracking and in-person
capture are cut. Online capture uses a shared Zoom/Meet/Teams tab and captures the
user's microphone separately. Transcript and Leaves share one name and meeting clock. Slack is the
only live content connector; email/chat/docs arrive by paste or upload.
Source provenance is immutable. Speech requires explicit confirmation.
The meeting grove uses its existing inactivity health rule. The account dashboard
shows completed seeds as blooming, overdue commitments and open risks as wilting,
and other open seeds as growing.

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

Keyboard and mouse are the supported inputs. Controls need
clear focus, readable labels, large targets, and reduced-motion support. State must
be conveyed by text and shape as well as color.

## Open Surface Decision

The initial view is provisionally a spatial garden with a details panel, based on the
team architecture. The question has been offered to the user; no additional audience
or product facts are inferred from silence.
