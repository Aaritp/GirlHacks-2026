---
name: Grovekeeper
description: A calm, legible planting plan for meeting commitments.
colors:
  pine: "#183b32"
  metal-deep: "#10271f"
  metal-reflection: "#6b877a"
  citron: "#d5e999"
  page: "#d9cbae"
  paper-raised: "#e6dac0"
  paper-sunk: "#cabb9b"
  rule: "#9f9070"
  rule-soft: "#bfb08c"
  ink: "#203a30"
  muted: "#445246"
  line: "#bfb08c"
  planted: "#719b45"
  growing: "#4a8058"
  blossom: "#d79cdd"
  needs-care: "#ae8053"
typography:
  headline:
    fontFamily: "Forum, serif"
    fontSize: "clamp(36px, 3.1vw, 48px)"
    fontWeight: 400
    lineHeight: 1.12
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Forum, serif"
    fontSize: "25px"
    fontWeight: 400
    lineHeight: 1.25
  body:
    fontFamily: "Forum, serif"
    fontSize: "18px"
    fontWeight: 400
  label:
    fontFamily: "Forum, serif"
    fontSize: "16px"
    fontWeight: 400
  wordmark:
    fontFamily: "Manrope Variable, sans-serif"
    fontSize: "21px"
    fontWeight: 750
rounded:
  pill: "999px"
  field: "10px"
  panel: "24px"
spacing:
  compact: "8px"
  group: "12px"
  panel: "20px"
  section: "24px"
components:
  button-primary:
    backgroundColor: "{colors.pine}"
    textColor: "{colors.panel}"
    rounded: "{rounded.pill}"
    padding: "11px 17px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "11px 17px"
    height: "44px"
  field:
    backgroundColor: "#fcfdfb"
    textColor: "#31462c"
    rounded: "{rounded.field}"
    padding: "9px 10px"
  navigation-active:
    backgroundColor: "{colors.citron}"
    textColor: "#23422f"
    rounded: "{rounded.pill}"
    padding: "10px 12px"
  panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "22px"
---

# Design System: Grovekeeper

## Overview

**Creative North Star: "The Living Planting Plan"**

Grovekeeper presents work as a legible garden diagram. A continuous sage ground gives
mature botanical specimens room, while pill controls and a floating white inspector
support everyday editing.
The botanical metaphor communicates state; it does not replace task names or actions.

**Key Characteristics:**
- Pine navigation, continuous sage ground, and floating white work surfaces.
- Natural-history botanical specimens paired with explicit growth labels.
- Calm, locally bundled sans typography and familiar form controls.
- Selection connects the garden to source context and progress actions.

## Colors

### Primary

A brushed dark-green metal anchors the rail, primary actions, and the direct-action
pill: a 118-degree gradient from `metal-deep` through a narrow `metal-reflection` band,
with a fine diagonal grain on the rail and an inset top highlight. Citron tints the
current navigation item and small confirmation accents. Use their token values rather than introducing
additional bright action colors.

### Secondary

Planted green, growing green, blossom lilac, and needs-care brown communicate the
four plant states. Text labels repeat the meaning of every color.

### Neutral

The page is a warm mid beige paper (`page`). Fields and raised surfaces use a
lighter paper, wells and hover states a slightly darker one, and hairlines a warm rule.
There is no white surface. Ink and secondary text stay green and are dark enough to read
on the paper (at least 4.5:1). `web/src/theme.css` holds these tokens and re-grounds every
feature's panels, including Ask the Grove, ingestion and Whispering Leaves.

**The State Has Words Rule.** Every growth color also has a text label and a distinct plant silhouette.

## Typography

Forum (regular 400 only) is bundled locally and carries headings, controls, and data.
Because it has a single weight, hierarchy comes from size, not boldness: the headline
runs 36-48px, section titles 25-28px, body and controls 17-18px, and nothing drops
below 14px. Manrope Variable is kept for the grovekeeper wordmark in the rail only.

**The One Voice Rule.** Use Forum everywhere except the wordmark; never fake a bold.

## Layout

Desktop uses a 220px pine rail, a broad garden, and a 300px inspector (320px on wide
screens). The inspector stacks below the garden at 1100px. At 700px, the rail becomes
a compact top navigation, the garden uses two columns, and a select replaces the
sidebar growth filters. Selecting a garden plant preserves its position on small
screens; its details shortcut opens and focuses the inspector. List selection opens
the inspector directly. A list view provides a second way to scan the same commitments.

Panel spacing follows the compact/group/panel/section scale. The garden is a data
diagram; D3 calculates positions and connecting curves while HTML buttons retain
keyboard access. The compact layout hides connecting curves, but the inspector still
lists the relationships in text.

## Elevation & Depth

Tonal layers define the workspace; fine borders remain for fields and source sections.
A soft ambient shadow lifts the white inspector and plant form. Selection lifts a
plant caption, while a small shadow separates its direct-action pill. The garden
itself stays flat and uninterrupted.

### Shadow Vocabulary

- **Selected caption:** `0 5px 18px #324d2812`.
- **Direct actions:** `0 6px 15px #193e3120`.
- **Inspector and plant form:** `0 8px 32px #193e3109`.
- **Selected view tab:** `0 1px 3px #263e2d14`.

**The Quiet Ground Rule.** Keep elevation on controls, selection, and the inspector; the planting ground stays continuous and calm.

## Shapes

Actions, navigation, filters, and status tags use pills. White work surfaces and the
pine rail share the panel radius; the broad garden has larger corners (28px, matching
the panel radius on mobile). Fields use the tighter field radius. Icon controls are
circular. Captions have soft corners (16px).

Transparent natural-history specimens replace geometric plant glyphs. Four botanical
states share a two-by-two PNG atlas; silhouettes and text labels distinguish planted,
growing, blooming, and needs-care states. The atlas carries its generation prompt in
PNG metadata. Lucide supplies surrounding interface icons with consistent strokes.
The garden has neither a dotted grid nor geometric planting beds.

## Components

### Buttons

Primary actions are pine with white text; secondary actions are white with a light
border. Normal actions have a 44px minimum height. Hover changes the surface color; pressing shifts an enabled action down one pixel.
Focus uses a visible three-pixel green outline with a three-pixel offset. Disabled
controls have reduced opacity and do not imply an available action.

### Inputs / Fields

Labels sit above native text, date, and multiline controls. Fields have lightly tinted
grounds, fine borders, and the same focus treatment as buttons. Error feedback states
that changes were not saved; it never substitutes a success state.

### Navigation and Chips

The current view has citron fill against pine. Growth filters carry a count and state
dot. Small status tags use tinted grounds but retain readable text. View controls are
buttons rather than links to nonexistent pages.

### Panels

The garden is a continuous sage surface; the inspector is a softly lifted white
surface. Owner and deadline are visible facts, with editing behind a native
"Edit commitment" disclosure. The inline plant form replaces the inspector, keeping
the garden visible instead of opening a modal. Inspector changes enter with a
180ms opacity and eight-pixel vertical transition.

### Plants and Roots

Plant selection lifts the specimen and highlights its caption and connected roots.
A pine pill reveals direct progress actions. The inspector provides directional
relationship labels. Botanical layers crossfade over 480ms; plant lift and scale use
360ms, both with `cubic-bezier(.16,1,.3,1)`. Growth changes appear after a successful
save. Reduced-motion preferences remove animations, transitions, and smooth scrolling;
status text remains available.

Unless the visitor has asked for reduced motion, content plays a short entrance the first
time it comes into view (`web/src/reveal.ts`): plants grow up from the ground, list and
timeline rows slide in along the reading line, panels lift and sharpen, and section rules
draw from the left. Items arriving together follow one another by 70ms. Without the
script everything is simply visible.

Desktop arrangement supports pointer drag and Alt + arrow keys. Drag follows the
pointer without easing. Positions are stored locally per meeting, independently of
seed progress and health; mobile keeps a two-column flow instead of free arrangement.
The sample meeting explicitly states that seed changes reset on reload.

## Do's and Don'ts

### Do:
- Do retain visible keyboard focus and native control semantics.
- Do pair plant state with text and silhouette.
- Do distinguish demo data and failed saves from persisted work.
- Do reuse the shared API and input bus for new feature integrations.

### Don't:
- Don't use color alone to explain health or completion.
- Don't refresh seed activity when only its appearance changes.
- Don't replace missing cloud services with an unlabeled mock success.
- Don't introduce decorative motion that competes with meeting tasks.
