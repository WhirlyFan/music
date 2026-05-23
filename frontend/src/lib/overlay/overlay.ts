import type { FC } from 'react'

import { type OverlayController, type OverlayProps, useOverlayStore } from './store'

export type OverlayAsyncProps<T> = Omit<OverlayProps, 'close'> & {
  close: (value: T) => void
}

export type OverlayAsyncController<T> = FC<OverlayAsyncProps<T>>

let counter = 0
const randomId = () => `overlay-${++counter}-${Math.random().toString(36).slice(2, 8)}`

export const overlay = {
  open(controller: OverlayController, options?: { overlayId?: string }) {
    const id = options?.overlayId ?? randomId()
    useOverlayStore.getState().add(id, controller)
    requestAnimationFrame(() => useOverlayStore.getState().open(id))
    return id
  },

  // Resolution contract:
  //   close(value)        → resolves with value
  //   closeAll / unmount  → resolves with null
  // The Promise never rejects. Callers branch on `result === null` (or `!result`
  // for falsy-T) and never need try/catch. Dialogs that hit internal errors
  // should handle them in-place (toast, retry) rather than propagating.
  openAsync<T>(controller: OverlayAsyncController<T>, options?: { overlayId?: string }) {
    return new Promise<T | null>((resolve) => {
      let settled = false
      let unsubscribe: () => void = () => {}
      const settle = (action: () => void) => {
        if (settled) return
        settled = true
        unsubscribe()
        action()
      }

      const id = this.open((props) => {
        const wrapped: OverlayAsyncProps<T> = {
          ...props,
          close: (value: T) =>
            settle(() => {
              resolve(value)
              props.close()
            }),
        }
        return controller(wrapped)
      }, options)

      // Radix only fires onOpenChange for user-initiated closes. closeAll() and
      // unmount(id) bypass it, so without this watcher the Promise would leak.
      // Resolve null on programmatic dismissal — callers don't need a try/catch.
      unsubscribe = useOverlayStore.subscribe((state, prev) => {
        if (settled) return
        if (prev.items[id] && !state.items[id]) {
          settle(() => resolve(null))
        }
      })
    })
  },

  close: (id: string) => useOverlayStore.getState().close(id),
  unmount: (id: string) => useOverlayStore.getState().remove(id),
  closeAll: () => useOverlayStore.getState().closeAll(),
}
