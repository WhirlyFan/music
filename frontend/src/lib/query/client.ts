import { QueryClient } from '@tanstack/react-query'

// Defaults follow the state-management skill: let React Query handle
// refetch-on-focus / refetch-on-reconnect natively, set staleTime to ~2min
// for typical data. Override per-query when something needs to be tighter
// (real-time-ish) or looser (auth state that rarely changes mid-session).
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000, // 2 minutes
      retry: 1,
    },
  },
})
