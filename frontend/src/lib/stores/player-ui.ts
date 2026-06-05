import { create } from 'zustand'

/**
 * Ephemeral player geometry (measured pixel heights) shared between the player and
 * the floating search pill / FAB so they can position around it. Client state →
 * Zustand (URL state lives in the router; server data in TanStack Query). The
 * player publishes these via ResizeObserver; consumers select what they need.
 */
type PlayerUiState = {
  queueHeight: number
  playerHeight: number
  setQueueHeight: (queueHeight: number) => void
  setPlayerHeight: (playerHeight: number) => void
}

export const usePlayerUiStore = create<PlayerUiState>((set) => ({
  queueHeight: 0,
  playerHeight: 0,
  setQueueHeight: (queueHeight) => set({ queueHeight }),
  setPlayerHeight: (playerHeight) => set({ playerHeight }),
}))
