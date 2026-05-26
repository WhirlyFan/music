---
name: ux-copywriting
description: >
  UX copywriting standards for button text, CTAs, error messages, empty states, confirmations, and
  UI microcopy. Covers voice and tone for defense, government, healthcare, and construction
  professionals. Use when writing any user-facing text.
---

# UX Copywriting

Users are trained professionals making consequential decisions. Copy MUST be precise, direct, and trustworthy. NEVER casual, clever, or ambiguous.

---

## Voice

**IS:** Clear. Direct. Respectful. Authoritative without being cold.
**NEVER:** Playful. Apologetic. Vague. Overly casual. Alarmist.

| Context            | Tone                   | Example                                                          |
| ------------------ | ---------------------- | ---------------------------------------------------------------- |
| Default UI         | Neutral, functional    | "Select a date range"                                            |
| Success            | Calm, factual          | "Report saved"                                                   |
| Warning            | Direct, specific       | "Unsaved changes will be lost"                                   |
| Error              | Factual, actionable    | "File could not be uploaded. Check the file size and try again." |
| Destructive action | Precise, no-drama      | "Delete record? This cannot be undone."                          |
| Empty state        | Helpful, task-oriented | "No reports found. Create a report to get started."              |

---

## Buttons & CTAs

**Formula:** Verb + object. Max 3 words. Verb MUST match the consequence.

| IF the action…                | THEN use…       | NEVER use…               |
| ----------------------------- | --------------- | ------------------------ |
| Saves data                    | "Save report"   | "Submit", "OK"           |
| Permanently destroys          | "Delete record" | "Remove", "Clear"        |
| Sends or transmits            | "Send request"  | "Go", "Continue"         |
| Opens a new view              | "View details"  | "Click here", "See more" |
| Confirms a destructive action | "Yes, delete"   | "Yes", "Confirm"         |
| Cancels                       | "Cancel"        | "Never mind", "Go back"  |

---

## Error Messages

**Formula:** `[What failed]. [Why]. [How to fix it].`

NEVER blame the user. NEVER use technical codes as the primary message.

| ❌ FAIL                | ✅ PASS                                                                      |
| ---------------------- | ---------------------------------------------------------------------------- |
| "An error occurred"    | "Report could not be saved. Check your connection and try again."            |
| "Invalid input"        | "File type not supported. Upload a PDF or CSV."                              |
| "Error 403"            | "You don't have permission to view this record. Contact your administrator." |
| "Something went wrong" | "Export failed. The file may be too large. Try a smaller date range."        |

---

## Confirmations & Destructive Actions

**Formula:** `[Verb] [specific object]? [Consequence].`

MUST name exactly what will be affected. MUST state if the action cannot be undone.

| ❌ FAIL                      | ✅ PASS                                                      |
| ---------------------------- | ------------------------------------------------------------ |
| "Are you sure?"              | "Delete this report? This cannot be undone."                 |
| "Confirm action"             | "Remove Johnson from this project?"                          |
| "This will delete your data" | "Delete all records from March 2024? This cannot be undone." |

---

## Empty States

**Formula:** `[What's missing]. [Why it's empty or what to do next].`

NEVER leave a blank screen. NEVER just say "No data."

| Context                 | ✅ PASS                                                                     |
| ----------------------- | --------------------------------------------------------------------------- |
| No results from search  | "No results for 'bridge inspection'. Try a different keyword."              |
| Nothing created yet     | "No reports yet. Create a report to get started."                           |
| Access restricted       | "No records available. You may not have permission to view this data."      |
| Filter returned nothing | "No records match the selected filters. Adjust the filters to see results." |

---

## Common Mistakes

| ❌ NEVER                           | ✅ INSTEAD                                                            |
| ---------------------------------- | --------------------------------------------------------------------- |
| "Please try again"                 | "Try again"                                                           |
| "Oops!"                            | Remove entirely                                                       |
| "Successfully saved!"              | "Saved"                                                               |
| "Are you sure you want to delete?" | "Delete [object]? This cannot be undone."                             |
| "You don't have access to this"    | "You don't have permission to view this. Contact your administrator." |
| Exclamation points                 | Never in this product                                                 |
| Ellipses in labels ("Loading...")  | "Loading" or use a progress label                                     |
