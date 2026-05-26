/**
 * DiceBear "glass" style avatar URL. Free HTTP API, no auth, SVG output —
 * use directly as <img src>. Seed is the user's email so each user gets a
 * stable, unique avatar without us storing any image data.
 *
 * Docs: https://www.dicebear.com/styles/glass/
 */
export function dicebearAvatarUrl(seed: string): string {
  const encoded = encodeURIComponent(seed)
  return `https://api.dicebear.com/9.x/glass/svg?seed=${encoded}`
}

/** Two-letter fallback used while the avatar image is loading or fails. */
export function avatarInitials(emailOrName: string): string {
  const trimmed = emailOrName.trim()
  if (!trimmed) return '?'
  const at = trimmed.indexOf('@')
  const handle = at > 0 ? trimmed.slice(0, at) : trimmed
  const parts = handle.split(/[._\-+\s]+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return handle.slice(0, 2).toUpperCase()
}
