import { User } from 'lucide-react'

import { dicebearAvatarUrl } from '@/lib/auth/avatar'
import { cn } from '@/lib/utils'

/**
 * A user's avatar: their unique DiceBear "glass" gradient with a person icon on top,
 * so a face-less colorful blob still clearly reads as a person. The muted backdrop +
 * theme-token icon keep it sitting in the theme (the glass SVG is transparent) rather
 * than floating. `size`/`icon` are Tailwind size utilities so callers tune both.
 */
export function UserAvatar({
  username,
  size = 'size-8',
  icon = 'size-4',
  className,
}: {
  username: string
  size?: string
  icon?: string
  className?: string
}) {
  return (
    <span
      className={cn(
        'bg-muted relative flex shrink-0 items-center justify-center overflow-hidden rounded-full',
        size,
        className,
      )}
    >
      <img
        src={dicebearAvatarUrl(username)}
        alt=""
        className="absolute inset-0 size-full object-cover"
      />
      <User
        className={cn('relative text-white drop-shadow-[0_1px_1.5px_rgba(0,0,0,0.55)]', icon)}
        aria-hidden
      />
    </span>
  )
}
