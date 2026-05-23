---
name: frontend-composition
description: Frontend component composition patterns including compound components, asChild/polymorphism, React 19 APIs, TypeScript patterns, controlled/uncontrolled state, dual API (composition + configuration), and page shell scaffolding. Use when designing component APIs or composition patterns.
---
# Frontend Composition

Frontend component composition patterns including compound components, asChild/polymorphism, React 19 APIs, TypeScript patterns, controlled/uncontrolled state, dual API (composition + configuration), and page shell scaffolding.

### Core Principles

1. **Composability and Reusability** — Favor composition over inheritance. Build components that can be combined and nested. Expose clear APIs via props/slots.
2. **Accessible by Default** — Use semantic HTML, WAI-ARIA attributes, keyboard navigation, focus management.
3. **Customizability and Theming** — Avoid hard-coded styles. Use CSS variables, documented class names, or style props.
4. **Lightweight and Performant** — Minimize dependencies and unnecessary re-renders.
5. **Transparency and Code Ownership** — Components should not be black boxes.
6. **Well-documented and DX-Friendly** — Clear documentation and examples.

### Compound Components

Instead of one component with dozens of props, distribute responsibility across cooperating components.

#### Why Compound Components

- **Separation of concerns** — each sub-component handles one responsibility
- **Flexibility** — consumers control structure and ordering
- **Readable JSX** — intent is clear from the markup
- **No prop explosion** — new features = new sub-components, not more props on root

#### Pattern: Tabs

```tsx
<Tabs defaultValue="account">
  <TabsList>
    <TabsTrigger value="account">Account</TabsTrigger>
    <TabsTrigger value="password">Password</TabsTrigger>
  </TabsList>
  <TabsContent value="account">Account settings...</TabsContent>
  <TabsContent value="password">Password settings...</TabsContent>
</Tabs>
```

- `Tabs` (Root) — manages state (active tab), provides context
- `TabsList` — layout container, handles keyboard navigation (ArrowLeft/Right)
- `TabsTrigger` — individual tab button, reads/writes active state from context
- `TabsContent` — panel that shows/hides based on active tab

#### Pattern: Accordion

```tsx
<Accordion type="single" collapsible>
  <AccordionItem value="item-1">
    <AccordionTrigger>Section 1</AccordionTrigger>
    <AccordionContent>Content 1</AccordionContent>
  </AccordionItem>
  <AccordionItem value="item-2">
    <AccordionTrigger>Section 2</AccordionTrigger>
    <AccordionContent>Content 2</AccordionContent>
  </AccordionItem>
</Accordion>
```

Each sub-component handles one responsibility: Root manages state, Item scopes context, Trigger handles interaction, Content renders body.

#### Pattern: Dialog

```tsx
<Dialog>
  <DialogTrigger asChild>
    <Button>Open Dialog</Button>
  </DialogTrigger>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Edit Profile</DialogTitle>
      <DialogDescription>Make changes to your profile.</DialogDescription>
    </DialogHeader>
    <div>Form content here</div>
    <DialogFooter>
      <Button type="submit">Save</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

#### Building Your Own Compound Component

Use React Context to share state between parent and children:

```tsx
import { createContext, useContext, useState } from "react";

type DisclosureContextType = {
  isOpen: boolean;
  toggle: () => void;
};

const DisclosureContext = createContext<DisclosureContextType | null>(null);

function useDisclosure() {
  const ctx = useContext(DisclosureContext);
  if (!ctx) throw new Error("useDisclosure must be used within Disclosure");
  return ctx;
}

function Disclosure({ children, defaultOpen = false }: { children: React.ReactNode; defaultOpen?: boolean }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <DisclosureContext.Provider value={{ isOpen, toggle: () => setIsOpen((o) => !o) }}>
      {children}
    </DisclosureContext.Provider>
  );
}

function DisclosureTrigger({ children }: { children: React.ReactNode }) {
  const { toggle } = useDisclosure();
  return <button onClick={toggle}>{children}</button>;
}

function DisclosureContent({ children }: { children: React.ReactNode }) {
  const { isOpen } = useDisclosure();
  if (!isOpen) return null;
  return <div>{children}</div>;
}

Disclosure.Trigger = DisclosureTrigger;
Disclosure.Content = DisclosureContent;
```

### Polymorphism with `asChild`

The `asChild` pattern (via Radix `Slot`) lets consumers change the rendered element without prop explosion:

```tsx
// Button renders as a link
<Button asChild>
  <Link href="/">Home</Link>
</Button>

// DialogTrigger renders as a custom button
<DialogTrigger asChild>
  <IconButton icon={<PlusIcon />} />
</DialogTrigger>
```

The parent's styles, event handlers, and ARIA attributes merge onto the child element. The parent does not render its own DOM node.

**When to use `asChild`:**
- Navigation links that need button styling
- Custom trigger elements for dialogs/popovers/tooltips
- Wrapping third-party components that need your component's behavior

**When NOT to use `asChild`:**
- When the default element is correct
- For simple className changes (use `className` prop instead)

### Render Props and Children-as-Function

For cases where a child component needs data from its parent without Context:

```tsx
<Listbox value={selected} onChange={setSelected}>
  {({ open }) => (
    <>
      <Listbox.Button>{selected.name}</Listbox.Button>
      {open && (
        <Listbox.Options>
          {options.map((option) => (
            <Listbox.Option key={option.id} value={option}>
              {({ active, selected }) => (
                <span className={cn(active && "bg-accent")}>
                  {selected && <CheckIcon />}
                  {option.name}
                </span>
              )}
            </Listbox.Option>
          ))}
        </Listbox.Options>
      )}
    </>
  )}
</Listbox>
```

**Use render props when:**
- Child needs parent state but Context is overkill (one-off relationship)
- The rendering logic varies significantly between consumers
- You need to expose internal state for custom rendering

### Controlled vs Uncontrolled

Support both patterns — uncontrolled (internal state + `defaultValue`) and controlled (`value` + `onChange`):

```tsx
function Toggle({
  value,
  defaultValue = false,
  onChange,
}: {
  value?: boolean;
  defaultValue?: boolean;
  onChange?: (value: boolean) => void;
}) {
  const [internal, setInternal] = useState(defaultValue);
  const isControlled = value !== undefined;
  const state = isControlled ? value : internal;

  const handleChange = () => {
    const next = !state;
    if (!isControlled) setInternal(next);
    onChange?.(next);
  };

  return (
    <button
      role="switch"
      aria-checked={state}
      onClick={handleChange}
      data-state={state ? "on" : "off"}
    >
      {state ? "On" : "Off"}
    </button>
  );
}

// Uncontrolled — component owns state
<Toggle defaultValue={true} onChange={(v) => console.log(v)} />

// Controlled — parent owns state
<Toggle value={isOn} onChange={setIsOn} />
```

### Dual API: Composition + Configuration

Build compound components first (composition API), then configured wrappers for the 80% case:

```tsx
// Composition API (full control)
<Select>
  <SelectTrigger>
    <SelectValue placeholder="Pick a fruit" />
  </SelectTrigger>
  <SelectContent>
    <SelectGroup>
      <SelectLabel>Fruits</SelectLabel>
      <SelectItem value="apple">Apple</SelectItem>
      <SelectItem value="banana">Banana</SelectItem>
    </SelectGroup>
  </SelectContent>
</Select>

// Configuration API (convenience wrapper)
<SimpleSelect
  placeholder="Pick a fruit"
  options={[
    { value: "apple", label: "Apple" },
    { value: "banana", label: "Banana" },
  ]}
/>
```

**Rules:**
1. **Composition first** — always build compound component API before configured wrapper
2. **Wrapper uses compound components** — no parallel implementation
3. **Rule of Three** — only create wrapper when pattern repeats 3+ times
4. **Escape hatch** — consumer drops to composition API when wrapper can't handle a case
5. **Don't nest wrappers** — if a wrapper needs another wrapper, use composition API instead

### TypeScript Patterns

#### Native Element Props

```tsx
// Extend native element props
type ButtonProps = React.ComponentProps<"button"> & {
  variant?: "default" | "destructive" | "outline";
  size?: "default" | "sm" | "lg";
};

function Button({ variant, size, className, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
```

#### Discriminated Unions

```tsx
// Props that depend on variant
type NotificationProps =
  | { variant: "simple"; title: string }
  | { variant: "action"; title: string; actionLabel: string; onAction: () => void }
  | { variant: "dismissible"; title: string; onDismiss: () => void };

function Notification(props: NotificationProps) {
  switch (props.variant) {
    case "simple":
      return <div>{props.title}</div>;
    case "action":
      return (
        <div>
          {props.title}
          <button onClick={props.onAction}>{props.actionLabel}</button>
        </div>
      );
    case "dismissible":
      return (
        <div>
          {props.title}
          <button onClick={props.onDismiss}>×</button>
        </div>
      );
  }
}
```

#### Generic Components

```tsx
// Type-safe data rendering
type ListProps<T> = {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  keyExtractor: (item: T) => string;
};

function List<T>({ items, renderItem, keyExtractor }: ListProps<T>) {
  return (
    <ul>
      {items.map((item, i) => (
        <li key={keyExtractor(item)}>{renderItem(item, i)}</li>
      ))}
    </ul>
  );
}

// Usage — T is inferred from items
<List
  items={users}
  keyExtractor={(u) => u.id}
  renderItem={(user) => <span>{user.name}</span>}
/>
```

#### CVA Integration

```tsx
import { cva, type VariantProps } from "class-variance-authority";

const badgeVariants = cva("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", {
  variants: {
    variant: {
      default: "bg-primary text-primary-foreground",
      secondary: "bg-secondary text-secondary-foreground",
      destructive: "bg-destructive text-destructive-foreground",
      outline: "border text-foreground",
    },
  },
  defaultVariants: { variant: "default" },
});

type BadgeProps = React.ComponentProps<"div"> & VariantProps<typeof badgeVariants>;

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
```

### React 19 APIs

#### `ref` as a Regular Prop

No more `forwardRef` wrapper. `ref` is just a prop:

```tsx
// React 19 — ref is a regular prop
function Input({ ref, ...props }: React.ComponentProps<"input">) {
  return <input ref={ref} {...props} />;
}
```

#### `use()` Hook

Read context and promises directly:

```tsx
import { use } from "react";

// Read context without useContext
function ThemeButton() {
  const theme = use(ThemeContext);
  return <button className={theme.buttonClass}>Click</button>;
}

// Read promise (must be in Suspense boundary)
function UserProfile({ userPromise }: { userPromise: Promise<User> }) {
  const user = use(userPromise);
  return <div>{user.name}</div>;
}
```

#### `useActionState` for Forms

```tsx
import { useActionState } from "react";

function LoginForm() {
  const [state, formAction, isPending] = useActionState(
    async (prevState: FormState, formData: FormData) => {
      const result = await login(formData);
      if (result.error) return { error: result.error };
      redirect("/dashboard");
    },
    { error: null }
  );

  return (
    <form action={formAction}>
      <input name="email" type="email" />
      <input name="password" type="password" />
      {state.error && <p role="alert">{state.error}</p>}
      <button type="submit" disabled={isPending}>
        {isPending ? "Logging in..." : "Log in"}
      </button>
    </form>
  );
}
```

#### `useOptimistic` for Optimistic UI

```tsx
import { useOptimistic } from "react";

function TodoList({ todos, addTodo }: { todos: Todo[]; addTodo: (text: string) => Promise<void> }) {
  const [optimisticTodos, addOptimisticTodo] = useOptimistic(
    todos,
    (state, newTodo: string) => [...state, { id: "temp", text: newTodo, pending: true }]
  );

  async function handleAdd(formData: FormData) {
    const text = formData.get("text") as string;
    addOptimisticTodo(text);
    await addTodo(text);
  }

  return (
    <div>
      <form action={handleAdd}>
        <input name="text" />
        <button type="submit">Add</button>
      </form>
      <ul>
        {optimisticTodos.map((todo) => (
          <li key={todo.id} style={{ opacity: todo.pending ? 0.5 : 1 }}>
            {todo.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

#### `<Activity>` Component

Show/hide without unmounting — preserves state and DOM:

```tsx
<Activity mode={activeTab === "settings" ? "visible" : "hidden"}>
  <SettingsPanel />
</Activity>
```

### Advanced Patterns

#### Multi-Slot Components

Components with multiple named render areas:

```tsx
type CardProps = {
  children: React.ReactNode;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  actions?: React.ReactNode;
};

function Card({ children, header, footer, actions }: CardProps) {
  return (
    <div className="rounded-lg border bg-card">
      {header && <div data-slot="card-header" className="border-b p-4">{header}</div>}
      <div data-slot="card-body" className="p-4">{children}</div>
      {(footer || actions) && (
        <div data-slot="card-footer" className="flex items-center justify-between border-t p-4">
          {footer}
          {actions && <div className="flex gap-2">{actions}</div>}
        </div>
      )}
    </div>
  );
}
```

#### Recursive Components

For tree-like data structures:

```tsx
type TreeNode = {
  id: string;
  label: string;
  children?: TreeNode[];
};

function TreeView({ nodes, level = 0 }: { nodes: TreeNode[]; level?: number }) {
  return (
    <ul role="tree" style={{ paddingLeft: level * 16 }}>
      {nodes.map((node) => (
        <li key={node.id} role="treeitem" aria-expanded={node.children ? true : undefined}>
          <span>{node.label}</span>
          {node.children && <TreeView nodes={node.children} level={level + 1} />}
        </li>
      ))}
    </ul>
  );
}
```

### Co-Located Skeletons

When a component has a loading/skeleton state, **co-locate the skeleton export in the same file** so that shared dimensions (heights, border-radius, padding) are written once. This prevents skeleton/content drift — anyone editing the real component sees the skeleton right next to it.

#### Pattern: Shared dimensions via CVA

Extract shared dimensions into a `cva()` call. Both the real component and its skeleton reference it — and Tailwind IntelliSense works inside `cva()` strings (via `classFunctions: ["cva"]`).

```tsx
// InboxSorts.tsx
import { cva } from "class-variance-authority";

const sortPillVariants = cva("flex h-6 items-center gap-1 rounded-[6px]");

export function InboxSorts({ sortMode, onSortChange }: InboxSortsProps) {
  return (
    <button className={cn(sortPillVariants(), "cursor-pointer select-none px-2 text-xs", ...)}>
      {/* real content */}
    </button>
  );
}

export function InboxSortsSkeleton() {
  return <Skeleton className={cn(sortPillVariants(), "w-36")} />;
}
```

**Why CVA over a string constant?** Raw `const PILL = "h-6 ..."` works but loses Tailwind IntelliSense (autocomplete, hover preview, linting). `cva()` is recognized by the Tailwind VSCode plugin, so you get full tooling support. If the shared styles later need variants (e.g., `size: "sm" | "md"`), CVA scales without a rewrite.

#### When to use this pattern

- The component renders a visually distinct element (pill, card, row) with specific dimensions
- A skeleton placeholder needs to match those dimensions
- The skeleton is used in a parent loading state (e.g., a page shell)

#### Rules

1. **Same file** — skeleton export lives next to the real component, not in a separate skeleton file
2. **Shared constant for dimensions** — height, border-radius, and layout classes go in a `const`. Color/interaction classes stay component-specific.
3. **Name convention** — `ComponentNameSkeleton` (e.g., `InboxSortsSkeleton`, `ContractCardSkeleton`)
4. **Don't over-skeleton** — only create co-located skeletons for components whose dimensions are referenced by a parent skeleton/shell. Not every component needs one.

### Testing Strategies

#### Component Testing Priorities

1. **User interactions** — click, type, keyboard navigation
2. **State transitions** — controlled/uncontrolled, open/closed
3. **Accessibility** — roles, ARIA attributes, focus management
4. **Edge cases** — empty state, error state, loading state

#### Testing Compound Components

```tsx
// Test the composed behavior, not individual sub-components
it("opens accordion item on trigger click", () => {
  render(
    <Accordion type="single">
      <AccordionItem value="item-1">
        <AccordionTrigger>Toggle</AccordionTrigger>
        <AccordionContent>Content</AccordionContent>
      </AccordionItem>
    </Accordion>
  );

  expect(screen.queryByText("Content")).not.toBeVisible();
  fireEvent.click(screen.getByText("Toggle"));
  expect(screen.getByText("Content")).toBeVisible();
});
```

#### Testing Accessibility

```tsx
it("has correct ARIA attributes", () => {
  render(<Tabs defaultValue="tab1">...</Tabs>);

  const tab = screen.getByRole("tab", { name: "Tab 1" });
  expect(tab).toHaveAttribute("aria-selected", "true");
  expect(tab).toHaveAttribute("aria-controls", "panel-tab1");
});
```
