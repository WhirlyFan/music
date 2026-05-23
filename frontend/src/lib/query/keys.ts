/** Centralized TanStack Query keys — easier invalidation + refactors. */
export const qk = {
  session: ['session'] as const,
  notes: () => ['notes'] as const,
  note: (id: number) => ['notes', id] as const,
  workflowRuns: () => ['workflow-runs'] as const,
  workflowRun: (id: number) => ['workflow-runs', id] as const,
}
