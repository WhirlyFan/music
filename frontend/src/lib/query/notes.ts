import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api/client'
import type { components } from '@/lib/api/types'
import { qk } from '@/lib/query/keys'

export type Note = components['schemas']['Note']
export type PaginatedNoteList = components['schemas']['PaginatedNoteList']

export function useNotes() {
  return useQuery({
    queryKey: qk.notes(),
    queryFn: () => api<PaginatedNoteList>('/notes/'),
  })
}

export function useCreateNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { title: string; body?: string }) =>
      api<Note>('/notes/', { method: 'POST', body: input }),

    // Optimistic create — show the new note immediately, roll back on failure.
    // Per the state-management skill: synchronous setQueryData in onMutate,
    // snapshot the previous cache, restore it in onError. No setTimeout.
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: qk.notes() })
      const previous = qc.getQueryData<PaginatedNoteList>(qk.notes())

      const optimistic: Note = {
        id: -Date.now(), // negative so it can't collide with a real id
        title: input.title,
        body: input.body ?? '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      qc.setQueryData<PaginatedNoteList>(qk.notes(), (old) =>
        old
          ? { ...old, count: old.count + 1, results: [optimistic, ...old.results] }
          : { count: 1, next: null, previous: null, results: [optimistic] },
      )

      return { previous }
    },

    onError: (_err, _input, context) => {
      if (context?.previous) {
        qc.setQueryData(qk.notes(), context.previous)
      }
    },

    // Always sync with the server's truth — server fills in id/created_at.
    onSettled: () => qc.invalidateQueries({ queryKey: qk.notes() }),
  })
}

export function useDeleteNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api<void>(`/notes/${id}/`, { method: 'DELETE' }),

    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: qk.notes() })
      const previous = qc.getQueryData<PaginatedNoteList>(qk.notes())

      qc.setQueryData<PaginatedNoteList>(qk.notes(), (old) =>
        old
          ? {
              ...old,
              count: Math.max(0, old.count - 1),
              results: old.results.filter((n) => n.id !== id),
            }
          : old,
      )

      return { previous }
    },

    onError: (_err, _id, context) => {
      if (context?.previous) {
        qc.setQueryData(qk.notes(), context.previous)
      }
    },

    onSettled: () => qc.invalidateQueries({ queryKey: qk.notes() }),
  })
}
