---
name: ux-accessibility
description: >
  WCAG AA accessibility rules for UX decisions, interaction patterns, copy, color, forms, error
  messaging, images, mobile, and testing. Apply to every component, page, and interactive element —
  even when accessibility is not explicitly mentioned. For ARIA, keyboard handler code, focus trap
  implementation, and component code patterns, see frontend-accessibility.
---

# UX Accessibility (WCAG AA)

Rules are non-negotiable. Every rule uses MUST or NEVER. "Should" does not appear in this document.
For implementation — ARIA, keyboard handlers, focus trapping, live regions — see `frontend-accessibility`.

---

## Four Immutable Principles

1. **Semantic HTML first.** `<button>`, `<a>`, `<label>`, `<nav>`, `<article>` exist. Use them. A native element is always correct over a styled `<div>` with ARIA added.
2. **ARIA is a last resort.** Add ARIA only when semantic HTML cannot express the meaning. Wrong ARIA breaks more than it fixes.
3. **Keyboard-first.** IF an interaction requires a mouse → it is incomplete. Every action must be reachable and operable by keyboard alone.
4. **Accessibility is not additive.** It is built in from the start. There is no "add accessibility pass" at the end.

---

## Fix Priority Order

| Priority | Category                        | WCAG                     | Impact      |
| -------- | ------------------------------- | ------------------------ | ----------- |
| 1        | Accessible names                | 1.1.1, 4.1.2             | Critical    |
| 2        | Keyboard interaction pattern    | 2.1.1, 2.1.2             | Critical    |
| 3        | Focus entry and exit points     | 2.4.3, 2.4.7, 2.4.11     | Critical    |
| 4        | Page structure and hierarchy    | 1.3.1, 2.4.6             | High        |
| 5        | Forms and errors                | 3.3.1, 3.3.2, 3.3.3      | High        |
| 6        | Announcements and state changes | 4.1.3, 4.1.2             | Medium-High |
| 7        | Color and contrast              | 1.4.1, 1.4.3, 1.4.11     | Medium      |
| 8        | Cognitive accessibility         | 3.1, 3.2, 3.3            | Medium      |
| 9        | Images, icons, media, motion    | 1.1.1, 1.2, 2.2.2, 2.3.1 | Low-Medium  |

---

## 1. Accessible Names (Critical — WCAG 1.1.1, 4.1.2)

An accessible name describes **purpose**, not appearance, location, or visual context.

**Decision table — evaluate every interactive element:**

| IF the element is…                  | THEN the accessible name must…                                     |
| ----------------------------------- | ------------------------------------------------------------------ |
| A button                            | Describe the action it performs                                    |
| A link                              | Describe the destination or outcome — readable out of context      |
| An icon-only control                | Be defined explicitly in the design spec — not left to engineering |
| A form field                        | Be a visible, persistent label positioned above the field          |
| A group of inputs (radio, checkbox) | Have a group label in addition to individual field labels          |
| An image used as a control          | Have a text alternative defined in the spec                        |

**Name evaluation test:** Read the element label aloud with no surrounding context. IF the purpose is unclear → it fails.

| ❌ FAIL                       | ✅ PASS                                                   |
| ----------------------------- | --------------------------------------------------------- |
| "Submit"                      | "Save changes", "Confirm order", "Delete account"         |
| "Click here"                  | "Read the Q3 accessibility report"                        |
| "Read more"                   | "Read more about pricing plans"                           |
| Icon button, no label in spec | Spec defines: "Close dialog", "Add to cart", "Share post" |
| Field with placeholder only   | Visible label above field: "Email address"                |

**NEVER:** Leave icon button label decisions to engineering.
**NEVER:** Use placeholder text as a field's only label — it disappears on input.

---

## 2. Keyboard Interaction Pattern (Critical — WCAG 2.1.1, 2.1.2)

**Rule:** IF an action is available on hover → it MUST also be available on focus.
**Rule:** IF an interaction uses drag-and-drop → a keyboard alternative MUST be designed (arrow key reorder, move menu, etc.).
**Rule:** Tab order MUST match visual reading order. Layout changes that break this MUST be caught at design time.

**Standard key bindings — apply to every custom component:**

| Key                 | Action                                   |
| ------------------- | ---------------------------------------- |
| `Tab` / `Shift+Tab` | Move between interactive elements        |
| `Enter` / `Space`   | Activate button or checkbox              |
| `Escape`            | Close modal, dropdown, drawer, popover   |
| `Arrow keys`        | Navigate menu, tabs, radio group, slider |
| `Home` / `End`      | Jump to first / last item                |

**For every custom component, the spec MUST define:**

- Which keys activate it
- How focus moves within it
- What `Escape` does
- Which standard pattern it follows (menu, tabs, dialog, slider, etc.)

Implementation of key handlers lives in `frontend-accessibility`.

---

## 3. Focus Entry and Exit Points (Critical — WCAG 2.4.3, 2.4.7)

**Rule:** Focus behavior MUST be specified in the design. It MUST NOT be improvised in code.

**For every overlay (modal, drawer, popover, sheet), the spec MUST define:**

| Event  | Required specification                                |
| ------ | ----------------------------------------------------- |
| Opens  | Which element receives focus first                    |
| Closes | Confirm focus returns to the exact triggering element |

**Additional rules:**

- Focus indicators MUST be visible and meet 3:1 contrast against adjacent colors
- NEVER specify `outline: none` without a designed replacement
- Sticky headers and fixed banners MUST NOT obscure the focused element — account for this in layout specs (WCAG 2.4.11)
- IF a loading state replaces content → specify whether focus moves to the new content or an announcement is made. One of the two is required

---

## 4. Page Structure and Hierarchy (High — WCAG 1.3.1, 2.4.6)

**Headings:**

- MUST reflect content hierarchy — not visual size
- Heading level (`h1`–`h6`) MUST be specified explicitly in handoff. Engineering MUST NOT infer it from font size
- NEVER skip levels (h1 → h3 is invalid)

**Landmarks:**

- Page regions MUST be defined: `header`, `nav`, `main`, `footer`
- NEVER rely on visual layout to imply structure

**Other structure:**

- IF items are a list → they MUST be specified as a list, not styled rows
- IF content is tabular data → column and row headers MUST be specified
- Reading order MUST match intended screen reader order — layout changes that break this MUST be caught at design time

---

## 5. Forms and Errors (High — WCAG 3.3.1, 3.3.2, 3.3.3)

**Field rules:**

- Every field MUST have a persistent visible label — not a placeholder, floating label, or tooltip
- Required fields MUST be marked visually and in the label text — NEVER by color alone
- Input format requirements MUST appear before submission — NEVER only after an error
- Disabled elements MUST explain why — not just appear greyed out
- Destructive or irreversible actions MUST require explicit confirmation (WCAG 3.3.4)

**Error message formula:** `[Field name]: [What went wrong]. [How to fix it].`

| ❌ FAIL                | ✅ PASS                                                          |
| ---------------------- | ---------------------------------------------------------------- |
| "Invalid input"        | "Email address: Enter a valid email, like name@example.com"      |
| "Required"             | "First name is required"                                         |
| "Error in field 3"     | "Password: Must be at least 8 characters and include one number" |
| "Something went wrong" | "Card number: Check your card number and try again"              |

**Error placement:** MUST be associated with the specific field. A generic banner alone is not sufficient unless the error relates to the entire form. Placement MUST be specified in the design.

---

## 6. Announcements and State Changes (Medium-High — WCAG 4.1.3)

**Rule:** IF content changes without a page reload → screen reader users MUST be informed.
**Rule:** Toast notifications MUST NEVER be the only delivery of critical information — they disappear. Always pair with a persistent inline state change.

**For every async or dynamic interaction, the spec MUST define:**

- What is announced on success
- What is announced on error
- Whether the announcement is polite or assertive

**Announcement priority:**

| Use POLITE (waits its turn) | Use ASSERTIVE (interrupts immediately) |
| --------------------------- | -------------------------------------- |
| Search results loaded       | Form submission error                  |
| Save confirmed              | Session timeout warning                |
| Filter applied              | Critical system error                  |
| Item added to cart          |                                        |

**Additional rules:**

- Loading indicators MUST have a text label — a spinner alone is not sufficient
- Expandable sections MUST communicate open/closed state — specify in handoff
- Badge counts and notification numbers MUST update accessibly

---

## 7. Color and Contrast (Medium — WCAG 1.4.1, 1.4.3, 1.4.11)

**WCAG AA minimum contrast ratios:**

| Element                          | Minimum Ratio |
| -------------------------------- | ------------- |
| Regular text (under 18pt)        | 4.5:1         |
| Large text (18pt+ or bold 14pt+) | 3:1           |
| UI components and icons          | 3:1           |
| Focus indicators                 | 3:1           |
| Placeholder text                 | 4.5:1         |

Verify: [webaim.org/resources/contrastchecker](https://webaim.org/resources/contrastchecker)

**Rules:**

- NEVER use color as the only indicator of meaning
- Error, warning, and success states MUST use color + icon + text — all three
- Links in body text MUST be distinguishable from surrounding text without color — underline or equivalent visual indicator required
- Disabled states MUST be perceivable beyond grey alone
- All palettes MUST be tested for protanopia, deuteranopia, and tritanopia
- Dark mode and high-contrast variants MUST meet the same ratios

---

## 8. Cognitive Accessibility (Medium — WCAG 3.1, 3.2, 3.3)

| Rule                                                                                           | WCAG  |
| ---------------------------------------------------------------------------------------------- | ----- |
| Use plain language — 8th grade reading level for general audiences                             | 3.1   |
| Same components MUST appear in the same locations across pages                                 | 3.2.3 |
| The same action MUST always use the same label — NEVER "Save" on one page, "Submit" on another | 3.2.4 |
| NEVER trigger context changes on focus alone — require deliberate user action                  | 3.2.1 |
| Instructions MUST NOT rely on shape, color, size, or location alone                            | 1.3.3 |
| IF a time limit exists → user MUST be able to extend or be warned before expiry                | 2.2.1 |
| Complex tasks MUST be broken into steps with clear progress indication                         | 3.3   |

---

## 9. Images, Icons, Media, and Motion

**Images and icons:**

| IF the image is…                    | THEN the spec MUST…                                                        |
| ----------------------------------- | -------------------------------------------------------------------------- |
| Meaningful (conveys information)    | Define a concise text description                                          |
| Decorative (purely visual)          | Mark as decorative — engineering applies `alt=""` and `aria-hidden="true"` |
| An inline icon next to visible text | Mark as decorative                                                         |
| Used as a control                   | Define a text alternative                                                  |

**Media:**

- All video with speech MUST have captions — specify in production requirements (WCAG 1.2.2)
- Audio-only content MUST have a text transcript (WCAG 1.2.1)
- NEVER autoplay audio without a visible, accessible mute/pause control

**Motion:**

- All non-essential animation MUST have a reduced-motion variant — design both states (WCAG 2.2.2)
- NEVER design content that flashes more than 3 times per second (WCAG 2.3.1)

**Mobile and touch:**

- Minimum tap target: 44×44px — use padding to enlarge hit area, not the visual element
- NEVER specify `maximum-scale` or `user-scalable=no` in viewport meta

---

## Testing Requirements

Every component MUST pass all of the following before it is considered done:

| Test                         | Tool                                 |
| ---------------------------- | ------------------------------------ |
| Automated ARIA/HTML scan     | `jest-axe`                           |
| Keyboard-only navigation     | Manual — no mouse                    |
| Visible focus states         | Visual review                        |
| Screen reader behavior       | VoiceOver (Mac) or NVDA (Windows)    |
| Color contrast               | webaim.org/resources/contrastchecker |
| Focus trap in modals/drawers | Manual keyboard test                 |
| Focus restoration on close   | Manual keyboard test                 |

---

## Common Mistakes

| ❌ NEVER                              | ✅ INSTEAD                                    | WCAG  |
| ------------------------------------- | --------------------------------------------- | ----- |
| `<div onClick={fn}>`                  | `<button onClick={fn}>`                       | 4.1.2 |
| Placeholder as only label             | Visible `<label>` above the field             | 3.3.2 |
| "Click here" / "Read more"            | Descriptive link text stating destination     | 2.4.4 |
| Icon button with no label in spec     | Label defined at design time                  | 4.1.2 |
| `outline: none` with no replacement   | Designed focus indicator meeting 3:1 contrast | 2.4.7 |
| Color-only error / warning / success  | Color + icon + text                           | 1.4.1 |
| Vague error message                   | Field name + what went wrong + how to fix     | 3.3.1 |
| Disabled with no explanation          | Explain why via associated visible text       | 4.1.2 |
| Modal with no specified first focus   | First focus element defined in spec           | 2.4.3 |
| Toast as only error feedback          | Persistent inline error + toast               | 4.1.3 |
| Inconsistent labels for same action   | One label, used everywhere                    | 3.2.4 |
| Drag-only interaction                 | Keyboard alternative designed                 | 2.1.1 |
| `maximum-scale=1` in viewport         | Remove — allow zoom                           | 1.4.4 |
| Decorative image with no alt guidance | Marked as decorative in spec                  | 1.1.1 |

---

## Audit Reporting Format

```
VIOLATION: [element or interaction]
WCAG: [criterion and level — e.g. 1.4.3 Level AA]
LEVEL: Critical / High / Medium / Low
WHY: [one sentence — user impact]
FIX: [concrete UX or copy recommendation]
```

Fix Critical first. Make targeted changes — do not redesign unaffected areas.
