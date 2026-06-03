import { useForm } from '@tanstack/react-form'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { FormError } from '@/components/ui/form-error'
import { Input } from '@/components/ui/input'
import { ApiError } from '@/lib/api/client'
import { fieldErrorMessage } from '@/lib/auth/errors'
import { promptText } from '@/lib/overlay'
import type { ImportResult } from '@/lib/query/catalog'
import { useCreatePlaylist, useIngest, usePlaylists } from '@/lib/query/catalog'
import { usePlay, usePlayNow, useQueueTracks } from '@/lib/query/rooms'

export const Route = createFileRoute('/playlists/')({
  component: PlaylistsPage,
  head: () => ({ meta: [{ title: 'Playlists — music' }] }),
})

const schema = z.object({
  url: z.string().url('Paste a valid Apple Music, Spotify, or YouTube link'),
})

/** Surface the backend's specific message (unsupported host, Spotify not
 *  configured, unreadable link) instead of a generic one. */
function ingestErrorMessage(error: unknown): string | null {
  if (!error) return null
  const detail = error instanceof ApiError ? (error.detail as { detail?: string })?.detail : null
  return detail ?? 'Import failed — check the link and try again.'
}

function PlaylistsPage() {
  const { data, isLoading, error } = usePlaylists()
  const ingest = useIngest()
  const [imported, setImported] = useState<ImportResult | null>(null)

  const form = useForm({
    defaultValues: { url: '' },
    validators: { onSubmit: schema },
    onSubmit: async ({ value, formApi }) => {
      const result = await ingest.mutateAsync(value.url)
      setImported(result) // a capped-import warning (result.note) renders in the result view
      formApi.reset()
    },
  })

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Playlists</h1>
        <p className="text-muted-foreground text-sm">
          Paste an Apple Music, Spotify, or YouTube link (playlist, album, or track) — then play or
          queue the tracks.
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
                  Playlist link
                </label>
                <Input
                  id={field.name}
                  type="url"
                  inputMode="url"
                  placeholder="Apple Music · Spotify · YouTube link"
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
        <FormError message={ingestErrorMessage(ingest.error)} />
      </form>

      {imported && <ImportResultView result={imported} />}

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Your playlists</h2>
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
            <p className="text-muted-foreground">
              No saved playlists yet — import above, build a queue, then save it from the player.
            </p>
          )}
        </ul>
      </section>
    </div>
  )
}

/** The just-imported tracks, with play / queue verbs (no playlist created). */
function ImportResultView({ result }: { result: ImportResult }) {
  const play = usePlay()
  const playNow = usePlayNow()
  const queueTracks = useQueueTracks()
  const createPlaylist = useCreatePlaylist()
  const trackIds = result.tracks.map((t) => t.id)

  async function saveAsPlaylist() {
    // Prompt for a name, pre-filled with the source's title (editable / optional).
    const name = await promptText({
      title: 'Save as playlist',
      label: 'Playlist name',
      defaultValue: result.title,
      confirmLabel: 'Save playlist',
    })
    if (!name) return
    createPlaylist.mutate(
      { title: name, trackIds },
      { onSuccess: () => toast.success(`Saved “${name}”.`) },
    )
  }

  return (
    <section
      aria-labelledby="import-result-heading"
      className="border-border space-y-3 rounded-lg border p-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="import-result-heading" className="font-medium">
            {result.title}
          </h2>
          <p className="text-muted-foreground text-sm">{result.track_count} tracks imported</p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() =>
              play.mutate(
                { trackIds, label: result.title },
                { onSuccess: () => toast.success('Playing.') },
              )
            }
          >
            Play all
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              queueTracks.mutate(
                { trackIds },
                { onSuccess: () => toast.success('Added to queue.') },
              )
            }
          >
            Add all to queue
          </Button>
          <Button size="sm" variant="outline" onClick={saveAsPlaylist}>
            Save as playlist
          </Button>
        </div>
      </div>

      {result.note && (
        <p
          role="status"
          className="motion-safe:animate-in motion-safe:fade-in rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400"
        >
          {result.note}
        </p>
      )}

      <ol className="space-y-2">
        {result.tracks.map((track, i) => (
          <li
            key={track.id}
            className="border-border flex items-center gap-3 rounded-lg border p-3"
          >
            <span className="text-muted-foreground w-6 text-right text-sm tabular-nums">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{track.title}</p>
              <p className="text-muted-foreground truncate text-sm">{track.primary_artist}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => playNow.mutate(track.id)}>
                Play
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  queueTracks.mutate(
                    { trackIds: [track.id] },
                    { onSuccess: () => toast.success('Added to queue.') },
                  )
                }
              >
                Add
              </Button>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
