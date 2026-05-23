import { useForm } from '@tanstack/react-form'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { confirm } from '@/lib/overlay'
import { useCreateNote, useDeleteNote, useNotes } from '@/lib/query/notes'

export const Route = createFileRoute('/notes')({
  component: NotesPage,
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
        className="space-y-3 rounded-lg border border-border p-4"
      >
        <form.Field name="title">
          {(field) => (
            <Input
              placeholder="Title"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
            />
          )}
        </form.Field>
        <form.Field name="body">
          {(field) => (
            <Textarea
              placeholder="Write a note…"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
            />
          )}
        </form.Field>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Saving…' : 'Add note'}
        </Button>
      </form>

      {isLoading && <p className="text-muted-foreground">Loading…</p>}
      {error && (
        <p className="text-destructive">
          {String((error as Error).message ?? 'Failed to load notes')}
        </p>
      )}

      <ul className="space-y-3">
        {data?.results.map((note) => (
          <li
            key={note.id}
            className="flex items-start gap-3 rounded-lg border border-border p-4"
          >
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
              onClick={async () => {
                const ok = await confirm({
                  title: 'Delete this note?',
                  description: `"${note.title}" will be permanently deleted.`,
                  confirmLabel: 'Delete',
                  destructive: true,
                })
                if (ok) remove.mutate(note.id)
              }}
              disabled={remove.isPending}
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
