import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useCallback } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'

import { importQuery } from '@/lib/hooks/queries/catalog'

const urlSchema = z.string().url()

/** A pasted import link (Spotify / Apple Music / YouTube) — the hosts the backend
 *  ingests. Anything else (plain text, an unrelated URL) is a normal paste. */
export function isImportUrl(text: string): boolean {
  if (!urlSchema.safeParse(text).success) return false
  try {
    const host = new URL(text).hostname.toLowerCase()
    return /(^|\.)(spotify\.com|apple\.com|youtube\.com|youtu\.be)$/.test(host)
  } catch {
    return false
  }
}

/**
 * An `onPaste` handler for any search field: if the pasted text is an importable
 * playlist/track link, intercept it (don't drop it into the search box) and go to
 * `/import` — validating the import first so a bad link never strands the user on a
 * broken page (same pattern as the home OmniBox). Non-import pastes pass through.
 */
export function useImportPaste() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  return useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      const text = e.clipboardData.getData('text').trim()
      if (!isImportUrl(text)) return // ordinary paste → let it land in the field
      e.preventDefault()
      void (async () => {
        const id = toast.loading('Importing…')
        try {
          await qc.fetchQuery(importQuery(text)) // cached under the key /import reads
          toast.dismiss(id)
          navigate({ to: '/import', search: { url: text } })
        } catch {
          toast.error(
            'Couldn’t import that link — check it’s a Spotify, Apple Music, or YouTube URL.',
            { id },
          )
        }
      })()
    },
    [qc, navigate],
  )
}
