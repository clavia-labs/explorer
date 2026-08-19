---
name: Clavia Lantern
description: A warm, ledger-dense trace review instrument based on the Flamecast product system.
colors:
  ground: "#f3f1eb"
  surface: "#fbfaf6"
  raised: "#fffdf8"
  rail: "#eeebe3"
  hover: "#eae7dd"
  ink: "#191712"
  ink-secondary: "#45413a"
  muted: "#7d7869"
  faint: "#a5a091"
  hairline: "#e0dccf"
  hairline-soft: "#e9e6da"
  hairline-strong: "#d3cebe"
  ember: "#b8431c"
  ember-deep: "#9a3715"
  running: "#a8740c"
  success: "#4f6b4a"
  failure: "#a3271d"
typography:
  display:
    fontFamily: "Newsreader Variable, Georgia, serif"
    fontSize: "31px"
    fontWeight: 500
    lineHeight: 1.22
    letterSpacing: "-0.026em"
  body:
    fontFamily: "Hanken Grotesk Variable, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "-0.01em"
  label:
    fontFamily: "Hanken Grotesk Variable, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "0"
  machine:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0"
rounded:
  control: "7px"
  panel: "12px"
  round: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.ember}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
  navigation-active:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 10px"
  compact-row:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    height: "44px"
---

# Design System: Clavia Lantern

## Overview

**Creative North Star: "The Lit Ledger"**

Clavia Lantern adapts Flamecast's product console for trace review. Warm neutral layers evoke a working notebook under steady light, while compact rows and fixed navigation behave like a precise ledger. The system is quiet enough for long review sessions and dense enough for side-by-side model analysis.

The interface rejects the generic SaaS dashboard, the neon observability console, the editorial marketing page, and the overloaded forensic log viewer. Emphasis appears only when it communicates selection, run state, policy, or a primary action.

**Key Characteristics:**

- Warm paper ground and tonal surface separation
- One ember accent per screen
- Serif display type only at the top of a page
- Sans text for human labels and mono text for machine values
- Compact 44 px rows and a fixed 216 px desktop rail
- Hairline boundaries with almost no resting shadow

## Colors

The palette uses Flamecast's warm mineral neutrals, ember accent, and muted semantic states. The frontmatter values are the strict sRGB contract. Implementation uses their equivalent OKLCH values.

### Primary

- **Ember:** Primary actions, active controls, focus rings, and the single strongest data mark on a screen.
- **Deep Ember:** Hover and pressed state for Ember controls.

### Secondary

- **Running Ochre:** Work in progress and warning states.
- **Moss Success:** Completed, passed, and healthy states.
- **Brick Failure:** Failed, blocked, and destructive states.

### Neutral

- **Warm Ground:** The main application ground.
- **Paper Surface:** Navigation selections, controls, and content panels.
- **Raised Paper:** Hovered or focused surfaces that need one additional tonal step.
- **Rail Clay:** The desktop navigation rail.
- **Warm Ink:** Primary text and icons.
- **Ledger Gray:** Secondary text.
- **Muted Umber:** Metadata and subdued labels.
- **Hairline Sand:** Boundaries and row dividers.

### Named Rules

**The One Ember Rule.** Use the accent for one primary action or one primary data series on a screen. State colors remain available for status.

**The Warm Ground Rule.** Every neutral carries the Flamecast warm hue. Cold gray and pure black or white are prohibited.

## Typography

**Display Font:** Newsreader Variable with Georgia fallback

**Body Font:** Hanken Grotesk Variable with system UI fallback

**Label/Mono Font:** IBM Plex Mono with a platform monospace fallback

**Character:** The serif supplies the measured authority of Flamecast's GT Pantheon without copying its proprietary font files. The humanist sans keeps operational text compact. Mono identifies hashes, IDs, timestamps, tools, and numerical evidence.

### Hierarchy

- **Display** (500, 31 px, 1.22): One page title or one review question at the top of a screen.
- **Headline** (500, 22 px, 1.25): Analysis sections and trace titles.
- **Title** (500, 14.5 px, 1.35): Rows, tools, and panel headings.
- **Body** (400, 14 px, 1.5): Explanations and trace content, with prose capped at 72 characters per line.
- **Label** (500, 12 px, 1.3): Controls, metadata, and column headings.
- **Machine** (400, 12 px, 1.5): IDs, hashes, timestamps, arguments, and compact metrics.

### Named Rules

**The One Display Rule.** Serif appears only in the page-level display title. Rows, labels, controls, and data remain sans or mono.

## Elevation

The system is flat at rest. Warm tonal layers, one hairline, and sticky position provide depth. A soft shadow appears only on a temporary floating surface such as a share panel.

### Shadow Vocabulary

- **Temporary Lift** (`0 12px 36px rgb(25 23 18 / 0.12)`): Share panels and menus only.
- **Focus Halo** (`0 0 0 3px rgb(184 67 28 / 0.10)`): Focused fields and grouped controls.

### Named Rules

**The One Hairline Rule.** Separate adjacent surfaces with space or one 1 px boundary. Never outline both parent and child.

**The Flat by Default Rule.** A resting dashboard panel has no shadow. Elevation must indicate temporary layering or focus.

## Components

### Buttons

- **Shape:** Gently curved controls with a 7 px radius and a minimum 44 px touch target.
- **Primary:** Ember background, warm surface text, and 10 px by 14 px internal spacing.
- **Hover / Focus:** Deep Ember on hover, 2 px Ember focus outline, and 110 ms color transitions.
- **Secondary / Ghost:** Paper Surface with one hairline, or transparent with Muted Umber text.

### Chips

- **Style:** Text and status word on a tonal background with a compact 7 px radius.
- **State:** Selected chips use Raised Paper and Warm Ink. Status chips pair text with an icon so color is never the only signal.

### Cards / Containers

- **Corner Style:** Panels use a 12 px radius only when grouping is necessary. Large analysis regions remain unboxed.
- **Background:** Paper Surface on Warm Ground.
- **Shadow Strategy:** Flat at rest, following the Elevation rules.
- **Border:** One Hairline Sand boundary.
- **Internal Padding:** 16 px for compact panels and 24 px for analysis panels.

### Inputs / Fields

- **Style:** Paper Surface, one Hairline Sand boundary, 7 px radius, and 44 px minimum height.
- **Focus:** Deepened boundary and Focus Halo.
- **Error / Disabled:** Brick Failure for errors. Disabled controls use Faint text and keep readable labels.

### Navigation

The desktop shell uses a 216 px Rail Clay column and a 48 px sticky work bar. Active links use Paper Surface and Warm Ink. Hover uses the Hover neutral. Mobile replaces the rail with a 56 px top bar and direct Analysis or Traces controls.

### Hierarchical Activity Tree

The default trace reader starts with collapsed semantic phases. A compact ribbon shows sequence and relative work. Each phase reports its purpose, turn count, tool count, and duration.

Opening a phase reveals compact turns. Opening a turn reveals the raw ATIF message, reasoning, tool arguments, and results. Search works on short semantic labels so large payloads do not slow the overview.

A reviewer can focus one phase subtree or show every turn. Long contiguous work is split into numbered passes so one phase cannot dominate the page.

### Linear Action Record

The linear reader remains available as an alternate view. Each action is one compact row on a continuous hairline rail. Tool name is the title, arguments form the machine-text preview, and result state appears as an icon plus word. Reasoning and payloads use native disclosure controls.

## Do's and Don'ts

### Do:

- **Do** preserve Flamecast's warm ground, hairline separation, and ledger density.
- **Do** use Ember for one primary action or one primary data series.
- **Do** keep model IDs, hashes, timestamps, tools, and metrics in mono text.
- **Do** give every control a 44 px target, visible focus, and a text label or accessible name.
- **Do** adapt structure at desktop, tablet, and mobile breakpoints.
- **Do** pair every run color with an icon or a status word.

### Don't:

- **Don't** build a generic SaaS dashboard with hero metrics or identical card grids.
- **Don't** build a neon observability console with cold gray, glow, or decorative gradients.
- **Don't** turn the product into an editorial marketing page with oversized serif type throughout.
- **Don't** expose every payload at once like an overloaded forensic log viewer.
- **Don't** use glass effects, gradient text, colored side stripes, nested cards, or bounce motion.
- **Don't** use pure black, pure white, or hard-coded colors outside the token definitions.
