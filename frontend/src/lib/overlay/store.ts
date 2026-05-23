import type { FC } from 'react'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

export type OverlayProps = {
  overlayId: string
  isOpen: boolean
  close: () => void
  unmount: () => void
}

export type OverlayController = FC<OverlayProps>

type OverlayItem = {
  id: string
  isOpen: boolean
  controller: OverlayController
}

type OverlayStore = {
  order: string[]
  items: Record<string, OverlayItem>
  add: (id: string, controller: OverlayController) => void
  open: (id: string) => void
  close: (id: string) => void
  remove: (id: string) => void
  closeAll: () => void
}

// Internal to lib/overlay. Not re-exported from index.ts — consumers use
// `overlay.*`, `<OverlayRenderer />`, and `confirm()` only.
export const useOverlayStore = create<OverlayStore>()(
  devtools(
    (set) => ({
      order: [],
      items: {},
      add: (id, controller) =>
        set(
          (s) => ({
            order: [...s.order, id],
            items: { ...s.items, [id]: { id, isOpen: false, controller } },
          }),
          false,
          'overlay/add',
        ),
      open: (id) =>
        set(
          (s) => {
            const item = s.items[id]
            if (!item || item.isOpen) return s
            return { items: { ...s.items, [id]: { ...item, isOpen: true } } }
          },
          false,
          'overlay/open',
        ),
      close: (id) =>
        set(
          (s) => {
            const item = s.items[id]
            if (!item || !item.isOpen) return s
            return { items: { ...s.items, [id]: { ...item, isOpen: false } } }
          },
          false,
          'overlay/close',
        ),
      remove: (id) =>
        set(
          (s) => {
            if (!s.items[id]) return s
            const items = Object.fromEntries(Object.entries(s.items).filter(([k]) => k !== id))
            return { order: s.order.filter((x) => x !== id), items }
          },
          false,
          'overlay/remove',
        ),
      closeAll: () =>
        set(
          (s) => ({
            items: Object.fromEntries(
              Object.entries(s.items).map(([id, item]) => [id, { ...item, isOpen: false }]),
            ),
          }),
          false,
          'overlay/closeAll',
        ),
    }),
    { name: 'overlay-store' },
  ),
)
