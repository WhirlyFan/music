import { useForm } from '@tanstack/react-form'
import { Search } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'

import { ExplicitBadge, TrackArtwork } from '@/components/track/track-artwork'
import { Button } from '@/components/ui/button'
import { RainbowButton } from '@/components/ui/rainbow-button'
import { Input } from '@/components/ui/input'
import { ApiError } from '@/lib/api/client'
import { promptText } from '@/lib/overlay'
import type { ImportResult } from '@/lib/query/catalog'
import { useCreatePlaylist, useIngest } from '@/lib/query/catalog'
import { usePlay, usePlayNow, useQueueTracks } from '@/lib/query/rooms'

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

/**
 * The home hub: a single, centered "paste a playlist link" search field
 * (Spotify / Apple Music / YouTube), with the imported tracks rendered inline
 * below. Search-page styling, app theme.
 */
export function ImportHub() {
  const ingest = useIngest()
  const [imported, setImported] = useState<ImportResult | null>(null)
  const fieldRef = useRef<HTMLDivElement>(null)

  const form = useForm({
    defaultValues: { url: '' },
    onSubmit: async ({ value, formApi }) => {
      try {
        const result = await ingest.mutateAsync(value.url)
        setImported(result) // a capped-import warning (result.note) renders in the result view
        formApi.reset()
      } catch (err) {
        toast.error(ingestErrorMessage(err) ?? 'Import failed — check the link and try again.')
      }
    },
  })

  // Empty/invalid link → just wiggle the field (the placeholder already says what
  // to paste — no redundant toast, no inline red validator text). We shake the
  // whole field wrapper (icon + input together, so the search icon rides along),
  // restarting the CSS animation imperatively (remove → reflow → add) so a
  // repeated bad submit shakes every time. Handler-only, no state.
  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!schema.safeParse({ url: form.getFieldValue('url').trim() }).success) {
      const el = fieldRef.current
      if (el) {
        el.classList.remove('animate-wiggle')
        void el.offsetWidth
        el.classList.add('animate-wiggle')
      }
      return
    }
    form.handleSubmit()
  }

  return (
    <div className="space-y-10">
      <section className="mx-auto flex max-w-xl flex-col items-center pt-10 text-center sm:pt-16">
        <h1 className="shimmer-text text-3xl font-semibold tracking-tight">
          What do you want to hear?
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Paste a Spotify, Apple Music, or YouTube link — playlist, album, or track.
        </p>

        <form onSubmit={onSubmit} aria-label="Import a playlist" className="mt-6 w-full space-y-3">
          <form.Field name="url">
            {(field) => (
              <div
                ref={fieldRef}
                className="relative"
                onAnimationEnd={(e) => e.currentTarget.classList.remove('animate-wiggle')}
              >
                <Search
                  className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2"
                  aria-hidden
                />
                <Input
                  id={field.name}
                  type="url"
                  inputMode="url"
                  aria-label="Playlist link"
                  placeholder="Paste a playlist, album, or track link"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  className="h-12 rounded-full pr-4 pl-11 text-base shadow-sm"
                />
              </div>
            )}
          </form.Field>
          <RainbowButton
            type="submit"
            size="lg"
            aria-busy={ingest.isPending || undefined}
            aria-disabled={ingest.isPending || undefined}
            className={`rounded-full ${ingest.isPending ? 'pointer-events-none opacity-60' : ''}`}
          >
            {ingest.isPending ? 'Importing…' : 'Import'}
          </RainbowButton>
        </form>
      </section>

      {imported && <ImportResultView result={imported} />}
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
      { title: name, trackIds, artworkUrl: result.cover ?? undefined },
      { onSuccess: () => toast.success(`Saved “${name}”.`) },
    )
  }

  return (
    <section
      aria-labelledby="import-result-heading"
      className="border-border mx-auto max-w-2xl space-y-3 rounded-lg border p-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <h2 id="import-result-heading" className="font-medium">
            {result.title}
          </h2>
          <p className="text-muted-foreground text-sm">{result.track_count} tracks imported</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            size="sm"
            className="w-full sm:w-auto"
            onClick={() => play.mutate({ trackIds, label: result.title })}
          >
            Play all
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() =>
              queueTracks.mutate({ trackIds }, { onSuccess: () => toast.success('Added to queue.') })
            }
          >
            Add all to queue
          </Button>
          <Button size="sm" variant="outline" className="w-full sm:w-auto" onClick={saveAsPlaylist}>
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
          <li key={track.id} className="border-border flex items-center gap-3 rounded-lg border p-3">
            <span className="text-muted-foreground w-6 text-right text-sm tabular-nums">
              {i + 1}
            </span>
            <TrackArtwork track={track} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                {track.is_explicit && <ExplicitBadge />}
                <p className="truncate font-medium">{track.title}</p>
              </div>
              <p className="text-muted-foreground truncate text-sm">
                {[track.primary_artist, track.album_name].filter(Boolean).join(' · ')}
              </p>
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
