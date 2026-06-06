import { Link } from '@tanstack/react-router'
import { User } from 'lucide-react'

import { dicebearAvatarUrl } from '@/lib/auth/avatar'
import { cn } from '@/lib/utils'

/**
 * A user's avatar: their unique DiceBear "glass" gradient with a person icon on top,
 * so a face-less colorful blob still clearly reads as a person. The muted backdrop +
 * theme-token icon keep it sitting in the theme (the glass SVG is transparent) rather
 * than floating. `size`/`icon` are Tailwind size utilities so callers tune both.
 *
 * Pass `link` to make it navigate to the user's public profile (/u/<username>) —
 * the way you reach someone's profile to add them.
 */
export function UserAvatar({
  username,
  size = 'size-8',
  icon = 'size-4',
  className,
  link = false,
}: {
  username: string
  size?: string
  icon?: string
  className?: string
  link?: boolean
}) {
  const avatar = (
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
      {/* Dark icon — the DiceBear "glass" gradient is bright/pastel, so a black
          person reads far better on it than white. A faint light glow keeps it
          legible over the occasional darker corner of the gradient. */}
      <User
        className={cn(
          'relative text-black/80 drop-shadow-[0_1px_1px_rgba(255,255,255,0.5)]',
          icon,
        )}
        aria-hidden
      />
    </span>
  )

  if (!link) return avatar
  return (
    <Link
      to="/u/$username"
      params={{ username }}
      aria-label={`@${username}'s profile`}
      className="ring-offset-background focus-visible:ring-ring shrink-0 rounded-full transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
    >
      {avatar}
    </Link>
  )
}
