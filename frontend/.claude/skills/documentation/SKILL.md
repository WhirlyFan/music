---
name: frontend-documentation
description: Internal frontend component documentation standards. Covers essential sections (overview, demo, features, examples, props/API, accessibility, changelog), best practices, and documentation framework options. Use when writing component documentation.
---

# Frontend Documentation

Internal frontend component documentation standards. Covers essential sections, best practices, and documentation framework options.

### Documentation Framework Options

| Framework               | Best For            | Key Features                                              |
| ----------------------- | ------------------- | --------------------------------------------------------- |
| **Fumadocs**            | Next.js projects    | Fast, feature-rich, built for App Router, Auto Type Table |
| **Nextra**              | Markdown-heavy docs | Built-in search, MDX support, file-system routing         |
| **Content Collections** | Type-safe content   | Schema validation, transforms, type generation            |
| **Docusaurus**          | Large doc sites     | Versioning, i18n, plugin ecosystem                        |
| **VitePress**           | Vue-powered docs    | Optimized for docs, fast HMR, Markdown extensions         |

**Our recommendation:** Fumadocs for Next.js projects — integrates natively with App Router, supports MDX, and has Auto Type Table for generating prop documentation from TypeScript types.

### Essential Documentation Sections

Every component should have documentation covering these sections. Not every section needs to be long — simple components may only need Overview, Demo, Props, and a few Examples.

#### 1. Overview

Brief introduction: what the component does, when to use it, and when NOT to use it.

```md
## Overview

The `DataTable` component provides a feature-rich table with sorting, filtering, pagination,
and row selection. Built on TanStack Table with shadcn/ui styling.

**Use when:** You need an interactive table with any combination of sort, filter, paginate, or select.

**Don't use when:** You have a simple static list — use shadcn `<Table>` directly instead.
```

#### 2. Demo, Source Code, and Preview

Show the component in action with the code used to create the demo. Use tabbed interfaces for code/preview.

````md
## Demo

<Tabs defaultValue="preview">
  <TabsList>
    <TabsTrigger value="preview">Preview</TabsTrigger>
    <TabsTrigger value="code">Code</TabsTrigger>
  </TabsList>
  <TabsContent value="preview">
    <ComponentDemo />
  </TabsContent>
  <TabsContent value="code">
    ```tsx
    <Button variant="default" size="default">
      Click me
    </Button>
    ```
  </TabsContent>
</Tabs>
````

**Rules:**

- Every demo must be interactive — no static screenshots
- Show the minimal code needed to reproduce the demo
- Include import statements in code examples
- Use realistic data, not "Lorem ipsum"

#### 3. Features

Key capabilities list. Keep it scannable:

```md
## Features

- **Customizable** — Full control over styling via className and variant props
- **Accessible by default** — WAI-ARIA compliant, keyboard navigable, screen reader friendly
- **Composable** — Compound component API for maximum flexibility
- **Type-safe** — Full TypeScript support with discriminated unions and generic types
- **Theming support** — CSS variable-based design tokens, adapts to light/dark mode
- **Lightweight** — No unnecessary dependencies, tree-shakeable
- **SSR/SSG ready** — Works with Next.js Server Components and static generation
- **Well-documented** — Props reference, examples, accessibility notes, changelog
```

#### 4. Examples

Demonstrate flexibility with progressive complexity. Each example should include rendered output + corresponding code.

##### Variants

Show all visual variants:

```md
### Variants

<div className="flex gap-4 flex-wrap">
  <Button variant="default">Default</Button>
  <Button variant="destructive">Destructive</Button>
  <Button variant="outline">Outline</Button>
  <Button variant="secondary">Secondary</Button>
  <Button variant="ghost">Ghost</Button>
  <Button variant="link">Link</Button>
</div>
```

##### States

Show loading, disabled, error, success states:

```md
### States

<div className="flex gap-4 flex-wrap">
  <Button disabled>Disabled</Button>
  <Button aria-disabled="true">Aria Disabled</Button>
  <Button data-state="loading">
    <Loader2 className="animate-spin" />
    Loading
  </Button>
</div>
```

##### Advanced Usage

Complex scenarios and edge cases:

```md
### With Form Submission

<form action={handleSubmit}>
  <Button type="submit" disabled={isPending}>
    {isPending ? "Submitting..." : "Submit"}
  </Button>
</form>
```

##### Composition

How it works with other components:

```md
### As Navigation Link

<Button asChild>
  <Link href="/dashboard">Go to Dashboard</Link>
</Button>
```

##### Responsive Behavior

How it adapts to screen sizes:

```md
### Responsive

<Button size="sm" className="sm:hidden">Mobile</Button>
<Button size="default" className="hidden sm:inline-flex">Desktop</Button>
```

#### 5. Props and API Reference

For each prop, document:

| Field           | Description                     |
| --------------- | ------------------------------- |
| **Name**        | Prop identifier                 |
| **Type**        | TypeScript type definition      |
| **Default**     | Default value (or "required")   |
| **Required**    | Whether mandatory               |
| **Description** | What it does and when to use it |

```md
## Props

| Prop        | Type                                                                          | Default     | Description                            |
| ----------- | ----------------------------------------------------------------------------- | ----------- | -------------------------------------- |
| `variant`   | `"default" \| "destructive" \| "outline" \| "secondary" \| "ghost" \| "link"` | `"default"` | Visual style variant                   |
| `size`      | `"default" \| "sm" \| "lg" \| "icon"`                                         | `"default"` | Size variant                           |
| `asChild`   | `boolean`                                                                     | `false`     | Render as child element via Radix Slot |
| `className` | `string`                                                                      | —           | Additional CSS classes                 |
| `disabled`  | `boolean`                                                                     | `false`     | Disables the button                    |
```

**Tips:**

- Use Fumadocs Auto Type Table to generate prop tables from TypeScript types automatically
- Group props by category for complex components (e.g., "Appearance", "Behavior", "Accessibility")
- Document callback signatures: `onChange: (value: string) => void`
- Note which props are forwarded to the underlying HTML element

#### 6. Accessibility

Document how the component meets accessibility standards:

```md
## Accessibility

### Keyboard Navigation

| Key               | Action                   |
| ----------------- | ------------------------ |
| `Tab`             | Move focus to the button |
| `Enter` / `Space` | Activate the button      |

### ARIA Attributes

- Renders as native `<button>` element — inherits all native button semantics
- Use `aria-label` when button has no visible text (icon-only)
- Use `aria-disabled="true"` instead of `disabled` when you need the button
  to remain in the tab order with an explanation

### Screen Reader

- Announces button label and role automatically
- Loading state should include `aria-busy="true"` and descriptive text
- Disabled state announced via native `disabled` attribute

### Focus Management

- Visible focus indicator via `:focus-visible` (2px ring)
- Focus is not trapped — Tab moves to next element naturally
```

#### 7. Changelog and Versioning

Track changes with semantic versioning:

```md
## Changelog

### v2.0.0 (2026-01-15) — Breaking

- **Breaking:** Removed `color` prop — use `variant` instead
- **Breaking:** `size="xs"` removed — use `size="sm"` with custom className
- **Migration:** Replace `<Button color="red">` with `<Button variant="destructive">`

### v1.2.0 (2025-12-01)

- Added `asChild` prop for polymorphic rendering
- Added `icon` size variant

### v1.1.0 (2025-11-15)

- Added automatic icon spacing in buttons (no more `mr-2` needed)
- Fixed focus ring not showing in Safari
```

**Rules:**

- Use semantic versioning (major.minor.patch)
- Major = breaking changes, Minor = new features, Patch = bug fixes
- Include migration guides with before/after code examples for breaking changes
- Date every entry

### Best Practices

#### Writing Style

- Keep docs up-to-date with code changes — stale docs are worse than no docs
- Use real-world examples that solve actual problems — not contrived demos
- Include common pitfalls and troubleshooting sections
- Provide performance considerations when relevant
- Link to related components and patterns
- Make all code examples runnable and tested

#### Structure

- Start with the simplest example, then build complexity
- Group related examples under clear headings
- Use consistent naming across all component docs
- Include "Do / Don't" examples for common mistakes

#### Maintenance

- Review docs when component API changes
- Delete docs for removed components — don't leave ghosts
- Run code examples in CI if possible (MDX component tests)
- Track doc coverage — every exported component should have a doc page
