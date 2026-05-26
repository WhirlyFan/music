import { useForm } from '@tanstack/react-form'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { FormError } from '@/components/ui/form-error'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { confirm } from '@/lib/overlay'
import { useCreateNote, useDeleteNote, useNotes } from '@/lib/query/notes'

export const Route = createFileRoute('/notes')({
  component: NotesPage,
  head: () => ({ meta: [{ title: 'Notes — react-django-template' }] }),
})

const noteSchema = z.object({
  title: z.string().min(1, 'Required'),
  body: z.string(),
})

function NotesPage() {
  const { data, isLoading, error } = useNotes()
  const create = useCreateNote()
  const remove = useDeleteNote()

  const form = useForm({
    defaultValues: { title: '', body: '' },
    onSubmit: async ({ value, formApi }) => {
      await create.mutateAsync(value)
      formApi.reset()
    },
    validators: { onChange: noteSchema },
  })

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Notes</h1>
        <p className="text-sm text-muted-foreground">
          Only your own notes are visible — RLS enforces that at the database.
        </p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          form.handleSubmit()
        }}
        aria-labelledby="new-note-heading"
        className="space-y-3 rounded-lg border border-border p-4"
      >
        <h2 id="new-note-heading" className="sr-only">
          New note
        </h2>

        <form.Field name="title">
          {(field) => {
            const errorMsg = field.state.meta.errors[0]
            return (
              <div className="space-y-1">
                <label htmlFor={field.name} className="text-sm font-medium">
                  Title <span aria-hidden="true">*</span>
                  <span className="sr-only"> (required)</span>
                </label>
                <Input
                  id={field.name}
                  placeholder="What's on your mind?"
                  required
                  aria-required="true"
                  aria-invalid={errorMsg ? true : undefined}
                  aria-errormessage={errorMsg ? `${field.name}-error` : undefined}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                <FormError id={`${field.name}-error`} message={errorMsg ? String(errorMsg) : null} />
              </div>
            )
          }}
        </form.Field>

        <form.Field name="body">
          {(field) => (
            <div className="space-y-1">
              <label htmlFor={field.name} className="text-sm font-medium">
                Body
              </label>
              <Textarea
                id={field.name}
                placeholder="Optional — write a note…"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </div>
          )}
        </form.Field>

        <Button
          type="submit"
          // aria-busy + aria-disabled (rather than the HTML `disabled` attr)
          // so screen readers still see the button and hear "busy" — `disabled`
          // would remove it from the accessibility tree entirely.
          aria-busy={create.isPending || undefined}
          aria-disabled={create.isPending || undefined}
          className={create.isPending ? 'pointer-events-none opacity-60' : undefined}
        >
          {create.isPending ? 'Saving…' : 'Add note'}
        </Button>
      </form>

      {/* aria-live so screen readers announce "Loading…" and "N notes" without
          requiring focus to move. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {isLoading
          ? 'Loading notes'
          : data
            ? `${data.results.length} note${data.results.length === 1 ? '' : 's'}`
            : ''}
      </div>

      {isLoading && <p className="text-muted-foreground">Loading…</p>}
      <FormError
        message={error ? String((error as Error).message ?? 'Failed to load notes') : null}
      />

      <ul className="space-y-3">
        {data?.results.map((note) => (
          <li key={note.id} className="flex items-start gap-3 rounded-lg border border-border p-4">
            <div className="flex-1 space-y-1">
              <p className="font-medium">{note.title}</p>
              {note.body && <p className="text-sm text-muted-foreground">{note.body}</p>}
              <p className="text-xs text-muted-foreground">
                {new Date(note.created_at).toLocaleString()}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              // Per-note context so screen reader announces "Delete note: <title>"
              aria-label={`Delete note: ${note.title}`}
              onClick={async () => {
                const ok = await confirm({
                  title: 'Delete this note?',
                  description: `"${note.title}" will be permanently deleted.`,
                  confirmLabel: 'Delete',
                  destructive: true,
                })
                if (ok) remove.mutate(note.id)
              }}
              aria-busy={remove.isPending || undefined}
              className="min-h-11 min-w-11"
            >
              Delete
            </Button>
          </li>
        ))}
        {data?.results.length === 0 && (
          <p className="text-muted-foreground">No notes yet — add one above.</p>
        )}
      </ul>
    </div>
  )
}
