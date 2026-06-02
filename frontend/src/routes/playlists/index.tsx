import { useForm } from '@tanstack/react-form'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { FormError } from '@/components/ui/form-error'
import { Input } from '@/components/ui/input'
import { fieldErrorMessage } from '@/lib/auth/errors'
import { useIngestPlaylist, usePlaylists } from '@/lib/query/catalog'

export const Route = createFileRoute('/playlists/')({
  component: PlaylistsPage,
  head: () => ({ meta: [{ title: 'Playlists — music' }] }),
})

const schema = z.object({
  url: z.string().url('Paste a valid Apple Music playlist or album URL'),
})

function PlaylistsPage() {
  const { data, isLoading, error } = usePlaylists()
  const ingest = useIngestPlaylist()
  const navigate = useNavigate()

  const form = useForm({
    defaultValues: { url: '' },
    validators: { onSubmit: schema },
    onSubmit: async ({ value, formApi }) => {
      const playlist = await ingest.mutateAsync(value.url)
      formApi.reset()
      navigate({ to: '/playlists/$playlistId', params: { playlistId: playlist.id } })
    },
  })

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Playlists</h1>
        <p className="text-muted-foreground text-sm">
          Paste an Apple Music playlist or album link to import it.
        </p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          form.handleSubmit()
        }}
        aria-labelledby="import-heading"
        className="border-border space-y-3 rounded-lg border p-4"
      >
        <h2 id="import-heading" className="sr-only">
          Import a playlist
        </h2>
        <form.Field name="url">
          {(field) => {
            const errorMsg = fieldErrorMessage(field.state.meta.errors[0])
            return (
              <div className="space-y-1">
                <label htmlFor={field.name} className="text-sm font-medium">
                  Apple Music URL
                </label>
                <Input
                  id={field.name}
                  type="url"
                  inputMode="url"
                  placeholder="https://music.apple.com/us/playlist/…"
                  aria-invalid={errorMsg ? true : undefined}
                  aria-errormessage={errorMsg ? `${field.name}-error` : undefined}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                <FormError id={`${field.name}-error`} message={errorMsg} />
              </div>
            )
          }}
        </form.Field>
        <Button
          type="submit"
          aria-busy={ingest.isPending || undefined}
          aria-disabled={ingest.isPending || undefined}
          className={ingest.isPending ? 'pointer-events-none opacity-60' : undefined}
        >
          {ingest.isPending ? 'Importing…' : 'Import'}
        </Button>
        <FormError message={ingest.error ? 'Import failed — check the URL and try again.' : null} />
      </form>

      {isLoading && <p className="text-muted-foreground">Loading…</p>}
      <FormError message={error ? 'Failed to load playlists.' : null} />

      <ul className="space-y-2">
        {data?.results.map((playlist) => (
          <li key={playlist.id}>
            <Link
              to="/playlists/$playlistId"
              params={{ playlistId: playlist.id }}
              className="border-border hover:bg-muted/50 flex items-center justify-between rounded-lg border p-4"
            >
              <span className="font-medium">{playlist.title}</span>
              <span className="text-muted-foreground text-sm">
                {playlist.track_count} track{playlist.track_count === 1 ? '' : 's'}
              </span>
            </Link>
          </li>
        ))}
        {data?.results.length === 0 && (
          <p className="text-muted-foreground">No playlists yet — import one above.</p>
        )}
      </ul>
    </div>
  )
}
