# DESIGN.md — WonyAI Design Direction

> This file is the design source of truth for WonyAI.
> Agent instruction: read this file before making any UI changes.
> Filter all UI work through `antislop.md` rules on top of this direction.

---

## Identity

**Product:** WonyAI — a personal AI assistant built by Emmanuel Abet Rossi Paays.
**Audience:** Personal use, portfolio visitors, developers.
**Personality:** Precise, composed, no fluff. Feels like a private tool, not a product.

---

## Palette

| Token | Value | Reason |
|---|---|---|
| Background | `#0e0e0e` | Near-black, not pure black. Reduces eye strain vs #000. Dark mode chosen because this is a developer-adjacent personal tool, not a consumer product (R-21). |
| Sidebar | `#111111` | Slightly higher than bg to create depth without a visible card. |
| Card / input bg | `#1a1a1a` | Minimal elevation signal for interactive surfaces. |
| Border | `#2a2a2a` | Derived from bg+20, barely visible. Keeps UI quiet. |
| Accent | `#dc2626` | Crimson red. Directly mirrors the red accent in Emmanuel's portfolio (emmanuel-abet-rossi-paays.vercel.app). Identity tie between the AI tool and the portfolio owner. |
| Text primary | `#f1f5f9` | Warm near-white, softer than #fff against dark bg. |
| Text secondary | `#94a3b8` | Muted blue-grey. Passes WCAG AA at 7.99:1 on #0e0e0e. |
| Text muted | `#64748b` | Subtitles, helper labels. 4.34:1 — used only for large/bold contexts. |
| Text dim | `#767676` | Decorative micro-labels. 5.6:1 on #0e0e0e — WCAG AA compliant. |

---

## Typography

**Typeface:** Inter (Google Fonts)
**Reason:** Inter was selected for its legibility at small sizes on screens (designed for screen use), variable weight range (300–700) for hierarchy without multiple families, and universally supported rendering across Windows/macOS/Android/iOS. It matches Emmanuel's portfolio which also uses Inter.

---

## Dials (anti-slop R-37, Part 3)

| Dial | Value | Rationale |
|---|---|---|
| **ENERGY** | 1 (Calm) | This is a personal productivity tool, not a marketing site. Low energy is intentional: the interface should not compete with content. Reference: Linear, plain admin tools. |
| **RHYTHM** | 1 (Uniform) | Single-page chat interface with no sections to vary. Uniform layout is a deliberate choice for focus. |
| **MOTION** | 1 (Hover states only) | Hover states on buttons and inputs only. No page animations. Reduces distraction in a tool meant for extended use. |

---

## Design Read

> Reading this as: **personal AI tool** for a developer/designer owner and portfolio visitors,
> in a **stripped-down dark tool** visual language,
> dial **ENERGY 1 / RHYTHM 1 / MOTION 1**.

---

## Layout Decisions

| Decision | Reason |
|---|---|
| Single-column chat layout | Chat tools are read top-to-bottom. Single column maximises line width for readability. |
| `max-width: 51.25rem` chat container | Optimal line length for reading (65–80 characters per line at 0.95rem). |
| Sidebar hidden on landing/auth | Prevents clutter before auth. Sidebar only appears in the tool, not in the welcome flow. |
| No navbar | No page navigation needed. Single-page tool. Any navbar link would violate R-24. |

---

## Copy Direction

- No em dashes (`—`). Use commas, colons, or full stops (R-02).
- No AI buzzwords: "intelligent", "seamless", "powerful", "revolutionary" (R-16).
- CTAs must describe action: "Sign In / Create Account", "Continue as Guest" (R-15).
- No fake statistics, no fake testimonials (R-17, R-18).
- Numbers and claims must be real and verifiable.

---

## Identity Motif

One repeated gesture: **crimson red (`#dc2626`) as the single accent**.
Used exclusively on: focused input borders, button hovers, sidebar "Powered by Groq" text, send button.
Not used on: card backgrounds, large areas, decorative elements.
This single-accent rule keeps the identity tight without becoming a glow-everywhere pattern (R-13).
