---
name: JobPilot
description: The job search as today's reservation chart: every application has a PNR and a status that moves along one ladder.
colors:
  railway-blue: "#1b3f8b"
  chart-buff: "#f3ebd3"
  chart-card: "#f8f2e1"
  chart-strip: "#eadfc0"
  chart-rule: "#cbbd98"
  chart-input-rule: "#b7a77f"
  ink: "#29251e"
  ink-muted: "#5e5545"
  signal-maroon: "#8b1e2d"
  confirmed-green: "#2f7a4d"
  caution-amber: "#8a5d00"
  refused-red: "#a3222f"
  night-ground: "#11214a"
  night-card: "#152858"
  night-strip: "#1a3066"
  night-rule: "#2e4884"
  night-band: "#1d4396"
  night-ink: "#f0e7cf"
  night-ink-muted: "#c2b99e"
  night-blue: "#a3bdf5"
  night-maroon: "#b83245"
typography:
  display:
    fontFamily: "Archivo Narrow, Arial Narrow, sans-serif"
    fontSize: "48px"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.005em"
  headline:
    fontFamily: "Archivo Narrow, Arial Narrow, sans-serif"
    fontSize: "36px"
    fontWeight: 700
    lineHeight: 1.05
  band-title:
    fontFamily: "Archivo Narrow, Arial Narrow, sans-serif"
    fontSize: "13px"
    fontWeight: 700
    letterSpacing: "0.1em"
  body:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Archivo Narrow, Arial Narrow, sans-serif"
    fontSize: "11.5px"
    fontWeight: 600
    letterSpacing: "0.12em"
  figures:
    fontFamily: "Martian Mono, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 400
    fontFeature: "tnum"
rounded:
  chart: "3px"
spacing:
  row-y: "12px"
  row-x: "16px"
  band-gap: "24px"
  page-x: "24px"
components:
  button-primary:
    backgroundColor: "{colors.railway-blue}"
    textColor: "{colors.chart-card}"
    rounded: "{rounded.chart}"
    height: "40px"
    padding: "0 16px"
  button-cta:
    backgroundColor: "{colors.signal-maroon}"
    textColor: "{colors.chart-card}"
    rounded: "{rounded.chart}"
    height: "48px"
    padding: "0 24px"
  button-outline:
    backgroundColor: "{colors.chart-card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.chart}"
    height: "32px"
    padding: "0 12px"
  input:
    backgroundColor: "{colors.chart-card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.chart}"
    height: "40px"
    padding: "8px 12px"
  band-head:
    backgroundColor: "{colors.chart-strip}"
    textColor: "{colors.ink}"
    typography: "{typography.band-title}"
    padding: "9px 14px"
  header-band:
    backgroundColor: "{colors.railway-blue}"
    textColor: "{colors.chart-card}"
    height: "56px"
---

# Design System: JobPilot

## Overview

**Creative North Star: "The Reservation Chart"**

JobPilot reads like the chart pasted on a train coach on departure day: a railway-blue header band, buff paper ruled into bands, and every passenger (here, every application) on one row with a reference number and a status. Applications get a PNR and move along a fixed ladder from New or Saved to Applied, Interview and Offer. The user scans the chart, acts on a row, and that row's ladder advances.

It is an Operate surface, and the world contributes only type, palette, density and one signature move: the PNR plus the status ladder. Navigation, forms, tables and buttons are ordinary web controls. Density is high but calm: thin rules separate rows, tinted strips head the bands, and colour carries meaning (blue is where you are, green is a confirmed step, amber is caution, maroon is the one thing to do next).

The night chart is the same paper at night: an ink-blue ground with buff ink, under the same railway-blue band.

**Key Characteristics:**
- Railway-blue header band over a buff Prepare strip; bands with tinted head strips.
- PNR references and figures in tabular Martian Mono; headings and labels in Archivo Narrow caps.
- One match ramp (five blocks) and one status ladder, used identically on every page.
- Square-ish corners (3px), 1px rules, no shadows.

## Colors

A committed two-scene palette: day chart (buff paper, blue band) and night chart (ink-blue paper, buff ink), both with the same small set of state colours.

### Primary
- **Railway Blue**: the header band, primary buttons, the current ladder step, links and focus rings. In the night chart the band stays a saturated railway blue (Night Band), brighter than the ink-blue ground, and interactive blue lightens to Night Blue so it holds contrast on ink.

### Secondary
- **Signal Maroon**: the single primary action of a screen (Find jobs everywhere, Email me a code). Night Maroon is the night-chart equivalent.

### Tertiary
- **Confirmed Green**: completed ladder steps, met checks, the high end of the match ramp.
- **Caution Amber**: cautions (experience gaps, follow-ups due today, AI drafts to review).
- **Refused Red**: errors, blockers, overdue follow-ups.

### Neutral
- **Chart Buff**: the page ground (day). **Chart Card**: band bodies and inputs. **Chart Strip**: band head strips and the Prepare strip.
- **Chart Rule / Input Rule**: 1px row and band rules; input borders.
- **Ink / Ink Muted**: body text and secondary text (≥4.5:1 on buff and strip).
- **Night Ground / Night Card / Night Strip / Night Rule / Night Ink / Night Ink Muted**: the same roles in the night chart.

### Named Rules
**The One Maroon Rule.** A screen has at most one maroon control. The header's Find jobs link hides on the home page, where the page's own Find button is the primary.

**The Meaning-Only Colour Rule.** Green, amber and red appear only when they carry state (done, caution, refused). Decoration is done with rules and type, never colour.

## Typography

**Display Font:** Archivo Narrow (with Arial Narrow fallback)
**Body Font:** Archivo (with system-ui fallback)
**Label/Mono Font:** Martian Mono for PNRs, counts, dates and scores

**Character:** A condensed grotesque for headers, like a chart's printed captions, over a plain readable sans; figures in a dot-matrix-flavoured mono so columns of numbers line up.

### Hierarchy
- **Display** (700, 40–48px, 1.05): the page title, e.g. "Chart for Sat, 14 Nov".
- **Headline** (700, 36px, 1.05): inner page titles (Discover jobs, Application tracker).
- **Band title** (700, 13px, 0.1em, uppercase): band head strips (NEW MATCHES, FOLLOW-UPS DUE).
- **Body** (400, 15px, 1.5): rows, forms, explanations; secondary lines 13px muted. Keep summaries to about 80ch.
- **Label** (600, 11.5px, 0.12em, uppercase): column heads and field names.
- **Figures** (Martian Mono 400, 12–13px, tabular): PNRs, scores, counts, "2d late".

### Named Rules
**The Figures-Are-Mono Rule.** Anything a user compares down a column (PNR, score, count, date offset) is set in Martian Mono with tabular numerals. Prose is never mono.

## Layout

Pages sit in a 1400px container with 16px (mobile) / 24px (desktop) side gutters. The home dashboard is two columns on desktop (a flexible main column and a 340px side column) and stacks to one column below 1024px. Bands are separated by 24px; rows have 12px vertical and 16px horizontal padding. Chart rows use a three-column grid (120px PNR and match, flexible role and company, auto status and actions) with a column-head row on desktop; on mobile the row stacks and keeps visible text labels on its buttons.

The shell is a 56px header band plus a 40px Prepare strip. Below 768px the main navigation moves into its own scrolling row inside the band with a right-edge fade, and the Prepare links leave the strip.

## Elevation & Depth

Flat. There are no shadows anywhere. Depth comes from tone and rules only: the railway-blue header band is the most saturated layer, band head strips are tinted, and band bodies sit one step lighter than the ground.

### Named Rules
**The Ruled-Not-Raised Rule.** Separate things with a 1px rule or a tinted strip, never a shadow or a floating card.

## Shapes

Corners are nearly square (3px) on bands, buttons, inputs and chips. Ladder steps and ramp blocks are sharp rectangles with 1px borders. Rows inside a band are divided by dotted rules, and bands by solid rules.

## Components

### Buttons
- **Shape:** nearly square (3px), Archivo Narrow 600 with slight tracking.
- **Primary:** Railway Blue fill, buff text, 40px tall.
- **CTA:** Signal Maroon fill, uppercase with 0.08em tracking, 48px tall; one per screen.
- **Outline:** card fill with an Input Rule border; used for row actions (Save, Tailor, Email) so rows never outshout the CTA.
- **Hover / Focus:** 10% darker fill or accent wash; 2px Railway Blue focus ring with offset.

### Inputs / Fields
- **Style:** card fill, 1px Input Rule border, 3px corners, 40px tall.
- **Focus:** 2px Railway Blue ring.

### Navigation
- **Header band:** uppercase Archivo Narrow 14px, inactive in pale band ink, active in white with a 2px bottom bar. Profile and Sign out sit at the right.
- **Prepare strip:** tools to prepare an application (Reply to a post, Cover letter, Resume upgrade, Resume score) in 13.5px body text; the current one is bold and underlined.

### Bands (signature container)
A ruled box with a tinted head strip carrying an uppercase title on the left and a muted sans meta line (counts, links) on the right. Empty bands say what's missing and the one action that fills it.

### PNR, Match Ramp and Status Ladder (signature component)
- **PNR:** a stable 7-digit reference ("PNR 231-6435") for any job or application, in muted mono.
- **Match ramp:** five 9px blocks plus the score; filled blocks are green at 70 or more, blue at 45–69, muted below.
- **Status ladder:** mono uppercase steps; completed steps filled green, the current step filled blue, later steps outlined; closed applications show one struck-through "Not selected" or "Withdrawn" tag.

## Do's and Don'ts

### Do:
- **Do** give every job and application its PNR and ladder, on every page that lists them.
- **Do** keep one maroon action per screen (Signal Maroon, 48px on the home page).
- **Do** head every group of rows with a band strip and, on desktop, a column-head row.
- **Do** set PNRs, scores, counts and dates in Martian Mono with tabular numerals.

### Don't:
- **Don't** add shadows, floating cards or large radii; this world is ruled paper (3px corners).
- **Don't** use colour for decoration; green, amber and red only for done, caution and refused.
- **Don't** reuse railway jargon for meaning (no "RAC" or "CNF" as statuses); labels stay plain (Saved, Applied, Interview, Offer).
- **Don't** use a coloured border-left above 1px to mark state; use a ladder step or a tag.
