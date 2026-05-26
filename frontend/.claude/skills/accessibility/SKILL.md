---
name: frontend-accessibility
description: Frontend accessibility (a11y) patterns including ARIA roles/states/properties, keyboard navigation, focus management (trapping, restoration), screen reader support, live regions, color contrast, mobile touch targets, and accessible component patterns. Use when building accessible components or fixing a11y issues.
---

# Frontend Accessibility

Frontend accessibility (a11y) patterns including ARIA roles/states/properties, keyboard navigation, focus management, screen reader support, live regions, color contrast, mobile touch targets, and accessible component patterns.

### Core Principles

#### 1. Semantic HTML First

Always start with the most appropriate HTML element. Semantic HTML provides built-in accessibility features — keyboard support, screen reader announcements, and focus management for free.

```tsx
// ❌ Div pretending to be a button — no keyboard support, no role, no focus
<div onClick={handleClick}>Click me</div>

// ✅ Native button — keyboard accessible, focusable, announced correctly
<button onClick={handleClick}>Click me</button>
```

```tsx
// ❌ Div pretending to be a link
<div onClick={() => router.push("/about")}>About</div>

// ✅ Native anchor — right-click, cmd+click, screen reader link list
<a href="/about">About</a>
```

Common semantic elements to prefer:

| Instead of             | Use                                 |
| ---------------------- | ----------------------------------- |
| `<div onClick>`        | `<button>`                          |
| `<div>` for navigation | `<nav>`                             |
| `<div>` for sections   | `<section>`, `<article>`, `<aside>` |
| `<div>` for headings   | `<h1>`–`<h6>`                       |
| `<span>` as link       | `<a href>`                          |
| `<div>` for lists      | `<ul>`, `<ol>`, `<dl>`              |

#### 2. Keyboard Navigation

Every interactive element must be keyboard accessible. Users must be able to reach and operate all controls with keyboard alone.

**Standard keyboard patterns:**

| Key                        | Action                                     |
| -------------------------- | ------------------------------------------ |
| `Tab`                      | Move focus to next interactive element     |
| `Shift+Tab`                | Move focus to previous interactive element |
| `Enter` / `Space`          | Activate focused element                   |
| `Escape`                   | Close/dismiss overlay, cancel action       |
| `ArrowDown` / `ArrowUp`    | Navigate within a list, menu, or select    |
| `ArrowLeft` / `ArrowRight` | Navigate tabs, horizontal lists            |
| `Home` / `End`             | Jump to first/last item in a list          |

```tsx
function Menu({ items }: { items: MenuItem[] }) {
  const [activeIndex, setActiveIndex] = useState(0)

  function handleKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActiveIndex((i) => Math.min(i + 1, items.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActiveIndex((i) => Math.max(i - 1, 0))
        break
      case 'Home':
        e.preventDefault()
        setActiveIndex(0)
        break
      case 'End':
        e.preventDefault()
        setActiveIndex(items.length - 1)
        break
      case 'Escape':
        onClose()
        break
    }
  }

  return (
    <ul role="menu" onKeyDown={handleKeyDown}>
      {items.map((item, index) => (
        <li
          key={item.id}
          role="menuitem"
          tabIndex={index === activeIndex ? 0 : -1}
          ref={(el) => {
            if (index === activeIndex) el?.focus()
          }}
        >
          {item.label}
        </li>
      ))}
    </ul>
  )
}
```

#### 3. Screen Reader Support

Use ARIA attributes to provide context that visual users get from layout and design:

```tsx
// Navigation with current page indicator
<nav aria-label="Main navigation">
  <a href="/" aria-current="page">Home</a>
  <a href="/about">About</a>
  <a href="/contact">Contact</a>
</nav>

// Icon button with accessible label
<button aria-label="Close dialog">
  <XIcon aria-hidden="true" />
</button>

// Status message that screen readers announce
<div aria-live="polite" aria-atomic="true">
  {statusMessage}
</div>
```

#### 4. Visual Accessibility

- Visible `:focus-visible` indicators — never `outline: none` without replacement
- Color contrast: 4.5:1 for normal text, 3:1 for large text (WCAG AA)
- Responsive text sizing with `rem` units — respects user font-size preferences
- Never rely on color alone to convey information

```css
/* Focus indicator — always visible */
*:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

/* Never do this */
*:focus {
  outline: none; /* ❌ Removes accessibility */
}
```

### ARIA Patterns

#### The Five Rules of ARIA

1. **Don't use ARIA if you can use semantic HTML** — `<button>` over `<div role="button">`
2. **Don't change native semantics** unless necessary — don't put `role="button"` on `<a>`
3. **All interactive ARIA elements must be keyboard accessible** — if it has `role="button"`, it needs `onKeyDown` for Enter/Space
4. **Don't hide focusable elements from assistive technologies** — never `aria-hidden="true"` on a focusable element
5. **All interactive elements must have accessible names** — via content, `aria-label`, or `aria-labelledby`

#### ARIA Roles

| Role          | Element       | Purpose                        |
| ------------- | ------------- | ------------------------------ |
| `dialog`      | Modal/sheet   | Identifies a dialog window     |
| `alertdialog` | Confirmation  | Dialog requiring user response |
| `menu`        | Dropdown      | Menu container                 |
| `menuitem`    | Menu option   | Individual menu item           |
| `tablist`     | Tab bar       | Container for tabs             |
| `tab`         | Tab button    | Individual tab                 |
| `tabpanel`    | Tab content   | Content associated with tab    |
| `tree`        | File browser  | Hierarchical list              |
| `treeitem`    | Tree node     | Individual tree item           |
| `progressbar` | Progress      | Shows progress of a task       |
| `status`      | Status area   | Advisory info that isn't alert |
| `alert`       | Error/warning | Important, time-sensitive info |

#### ARIA States

| State           | Values                 | Purpose                           |
| --------------- | ---------------------- | --------------------------------- |
| `aria-expanded` | `true`/`false`         | Expandable section is open/closed |
| `aria-selected` | `true`/`false`         | Tab/option is selected            |
| `aria-checked`  | `true`/`false`/`mixed` | Checkbox/radio state              |
| `aria-pressed`  | `true`/`false`/`mixed` | Toggle button state               |
| `aria-disabled` | `true`/`false`         | Element is disabled but visible   |
| `aria-hidden`   | `true`/`false`         | Hidden from assistive tech        |
| `aria-busy`     | `true`/`false`         | Region is being updated           |
| `aria-invalid`  | `true`/`false`         | Input has validation error        |
| `aria-required` | `true`/`false`         | Input is required                 |

#### ARIA Properties

| Property                | Purpose                                         |
| ----------------------- | ----------------------------------------------- |
| `aria-label`            | Accessible name when no visible text            |
| `aria-labelledby`       | Points to element with visible label            |
| `aria-describedby`      | Points to element with description              |
| `aria-errormessage`     | Points to error message element                 |
| `aria-controls`         | Element this control affects                    |
| `aria-haspopup`         | Indicates popup type (`true`, `menu`, `dialog`) |
| `aria-live`             | Announces dynamic content changes               |
| `aria-atomic`           | Announce entire region or just changes          |
| `aria-current`          | Current item (`page`, `step`, `date`, `true`)   |
| `aria-valuemin/max/now` | Range values for sliders/progress               |

### Component Patterns

#### Modal/Dialog

```tsx
function Dialog({ isOpen, onClose, title, children }: DialogProps) {
  const previousFocus = useRef<HTMLElement | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isOpen) {
      previousFocus.current = document.activeElement as HTMLElement
      dialogRef.current?.focus()
    } else {
      previousFocus.current?.focus()
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
      ref={dialogRef}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <h2 id="dialog-title">{title}</h2>
      {children}
      <FocusTrap>{children}</FocusTrap>
    </div>
  )
}
```

**Requirements:**

- Store and restore focus on open/close
- Trap focus within modal (Tab cycles through focusable elements)
- Close on Escape key
- Use `role="dialog"`, `aria-modal="true"`, `aria-labelledby`
- Prevent body scroll when open
- Clicking backdrop closes dialog

#### Dropdown Menu

```tsx
function DropdownMenu({ trigger, items }: DropdownMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  return (
    <div>
      <button
        ref={triggerRef}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={menuId}
        onClick={() => setIsOpen(!isOpen)}
      >
        {trigger}
      </button>
      {isOpen && (
        <ul id={menuId} role="menu" onKeyDown={handleKeyDown}>
          {items.map((item, index) => (
            <li
              key={item.id}
              role="menuitem"
              tabIndex={index === activeIndex ? 0 : -1}
              onClick={() => {
                item.onSelect()
                setIsOpen(false)
                triggerRef.current?.focus()
              }}
            >
              {item.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

**Requirements:**

- `aria-haspopup="menu"`, `aria-expanded`, `aria-controls`
- ArrowDown/Up for navigation, Enter/Space to select, Escape to close
- `role="menu"` on list, `role="menuitem"` on items
- Focus returns to trigger on close

#### Tabs

```tsx
function TabGroup({ tabs }: { tabs: TabConfig[] }) {
  const [activeIndex, setActiveIndex] = useState(0)

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowRight') {
      setActiveIndex((i) => (i + 1) % tabs.length)
    } else if (e.key === 'ArrowLeft') {
      setActiveIndex((i) => (i - 1 + tabs.length) % tabs.length)
    } else if (e.key === 'Home') {
      setActiveIndex(0)
    } else if (e.key === 'End') {
      setActiveIndex(tabs.length - 1)
    }
  }

  return (
    <div>
      <div role="tablist" onKeyDown={handleKeyDown}>
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeIndex === index}
            aria-controls={`panel-${tab.id}`}
            tabIndex={activeIndex === index ? 0 : -1}
            onClick={() => setActiveIndex(index)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab, index) => (
        <div
          key={tab.id}
          id={`panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`tab-${tab.id}`}
          hidden={activeIndex !== index}
          tabIndex={0}
        >
          {tab.content}
        </div>
      ))}
    </div>
  )
}
```

**Requirements:**

- `role="tablist"`, `role="tab"`, `role="tabpanel"`
- `aria-selected`, `aria-controls`, `aria-labelledby`
- ArrowLeft/Right for navigation
- `tabIndex={activeTab === index ? 0 : -1}` — roving tabindex pattern

#### Forms

```tsx
function FormField({ label, name, error, required, description, children }: FormFieldProps) {
  const inputId = useId()
  const errorId = `${inputId}-error`
  const descriptionId = `${inputId}-description`

  return (
    <div data-slot="form-field">
      <label htmlFor={inputId} data-slot="form-label">
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {description && (
        <p id={descriptionId} data-slot="form-description">
          {description}
        </p>
      )}
      {React.cloneElement(children as React.ReactElement, {
        id: inputId,
        'aria-required': required,
        'aria-invalid': !!error,
        'aria-describedby': cn(description && descriptionId, error && errorId),
        'aria-errormessage': error ? errorId : undefined,
      })}
      {error && (
        <p id={errorId} role="alert" data-slot="form-error">
          {error}
        </p>
      )}
    </div>
  )
}
```

**Requirements:**

- Always use `<label htmlFor>` — never just placeholder text
- `aria-required`, `aria-invalid`, `aria-describedby`, `aria-errormessage`
- Use `<fieldset>` + `<legend>` for groups of related inputs
- Show clear error messages with `role="alert"`
- Connect errors to inputs via `aria-describedby` or `aria-errormessage`

### Focus Management

#### Focus Visible

```css
/* Global focus indicator */
*:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

/* Remove default outline, rely on focus-visible */
*:focus:not(:focus-visible) {
  outline: none;
}
```

`:focus-visible` only shows focus indicators for keyboard navigation, not mouse clicks. This gives keyboard users clear indicators without visual noise for mouse users.

#### Focus Trapping

Keep focus within a region (modals, dialogs). On Tab at last element, wrap to first. On Shift+Tab at first, wrap to last.

```tsx
function FocusTrap({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return

      const focusable = container!.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    container.addEventListener('keydown', handleKeyDown)
    return () => container.removeEventListener('keydown', handleKeyDown)
  }, [])

  return <div ref={containerRef}>{children}</div>
}
```

#### Focus Restoration

Store `document.activeElement` before opening overlay, restore on close:

```tsx
function useOverlay() {
  const previousFocus = useRef<HTMLElement | null>(null)

  function open() {
    previousFocus.current = document.activeElement as HTMLElement
    // ... open overlay logic
  }

  function close() {
    // ... close overlay logic
    previousFocus.current?.focus()
  }

  return { open, close }
}
```

### Live Regions

Live regions announce dynamic content changes to screen readers without requiring focus:

```tsx
// Polite — waits for screen reader to finish current announcement
<div aria-live="polite" aria-atomic="true">
  {items.length} items found
</div>

// Assertive — interrupts current announcement (use sparingly)
<div role="alert">
  Error: Failed to save changes
</div>

// Loading state
<div aria-busy={isLoading} aria-live="polite">
  {isLoading ? "Loading..." : `${results.length} results`}
</div>

// Progress bar
<div
  role="progressbar"
  aria-valuenow={progress}
  aria-valuemin={0}
  aria-valuemax={100}
  aria-label="Upload progress"
>
  {progress}%
</div>
```

**Rules:**

- `aria-live="polite"` — waits for screen reader to finish (status messages, search results count)
- `aria-live="assertive"` / `role="alert"` — interrupts immediately (error messages, critical warnings)
- `aria-busy={isLoading}` — tells screen reader to wait before announcing
- `aria-atomic="true"` — announce the entire region, not just changed parts
- Live regions must be in the DOM before content changes — don't conditionally render the container

### Color and Contrast

#### WCAG AA Requirements

| Element                              | Minimum Ratio |
| ------------------------------------ | ------------- |
| Normal text (< 18pt)                 | 4.5:1         |
| Large text (>= 18pt or >= 14pt bold) | 3:1           |
| UI components and graphical objects  | 3:1           |
| Non-text contrast (borders, icons)   | 3:1           |

#### Rules

- Never convey information through color alone — add icons, text labels, or patterns
- Test with color blindness simulators (protanopia, deuteranopia, tritanopia)
- Ensure error states use more than just red — add error icon and descriptive text
- Links must be distinguishable from surrounding text by more than color (underline or other visual indicator)

```tsx
// ❌ Color-only status indication
<span className={status === "error" ? "text-red-500" : "text-green-500"}>
  {status}
</span>

// ✅ Color + icon + text
<span className={status === "error" ? "text-destructive" : "text-success"}>
  {status === "error" ? <AlertIcon /> : <CheckIcon />}
  {status === "error" ? "Failed" : "Success"}
</span>
```

### Mobile Accessibility

#### Touch Targets

- **Minimum size**: 44x44px (iOS Human Interface Guidelines) / 48x48dp (Material Design)
- Ensure adequate spacing between touch targets to prevent accidental taps
- Use padding rather than margin to increase touch target size without visual change

```tsx
// ❌ Too small
<button className="p-1">
  <XIcon className="h-4 w-4" />
</button>

// ✅ Adequate touch target
<button className="p-3">
  <XIcon className="h-4 w-4" />
</button>
```

#### Viewport and Zoom

- Allow viewport zooming — never use `user-scalable=no` or `maximum-scale=1`
- Use responsive units (`rem`, `em`, `%`) — not fixed `px` for text

```html
<!-- ❌ Prevents zoom -->
<meta
  name="viewport"
  content="width=device-width, initial-scale=1, user-scalable=no, maximum-scale=1"
/>

<!-- ✅ Allows zoom -->
<meta name="viewport" content="width=device-width, initial-scale=1" />
```

### Common Pitfalls

| Pitfall                                   | Why it's a problem                                            | Fix                                                           |
| ----------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------- |
| Placeholder text as only label            | Disappears on typing, low contrast                            | Use `<label htmlFor>`                                         |
| Icon buttons without `aria-label`         | Screen reader says "button" with no context                   | Add `aria-label="Close"`                                      |
| `disabled` attribute on critical actions  | Element removed from tab order entirely                       | Use `aria-disabled="true"` + explanation                      |
| `aria-hidden="true"` on focusable element | Focus trap — user can focus it but screen reader can't see it | Remove `aria-hidden` or make unfocusable                      |
| `tabIndex > 0`                            | Breaks natural tab order                                      | Only use `tabIndex={0}` or `tabIndex={-1}`                    |
| Missing skip navigation link              | Keyboard users must tab through entire nav on every page      | Add `<a href="#main" className="sr-only focus:not-sr-only">`  |
| Auto-playing media                        | Distracting, can't be paused by keyboard                      | Require user action to play, provide pause control            |
| Low contrast placeholder text             | Below 4.5:1 ratio                                             | Use `text-muted-foreground` with sufficient contrast          |
| Missing alt text on images                | Screen reader says "image" with no context                    | Add descriptive `alt` text, or `alt=""` for decorative images |
| Dynamic content without live region       | Screen reader doesn't announce changes                        | Add `aria-live="polite"` on container                         |
