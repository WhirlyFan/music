import { useOverlayStore } from './store'

export function OverlayRenderer() {
  const order = useOverlayStore((s) => s.order)
  const items = useOverlayStore((s) => s.items)
  const close = useOverlayStore((s) => s.close)
  const remove = useOverlayStore((s) => s.remove)

  return (
    <>
      {order.map((id) => {
        const item = items[id]
        if (!item) return null
        const Controller = item.controller
        return (
          <Controller
            key={id}
            overlayId={id}
            isOpen={item.isOpen}
            close={() => close(id)}
            unmount={() => remove(id)}
          />
        )
      })}
    </>
  )
}
