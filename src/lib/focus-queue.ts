// Type-only browser imports remain pure; legacy persistence callers use the server adapter.
export { type QueuePlacement, parseQueuePlacement, FocusQueueError,
  FocusQueueNotFoundError, FocusQueueConflictError } from "@/modules/planning/domain/focus-queue";
export { listFocusQueue, consumeFocusQueueTask, compactFocusQueue,
  addToFocusQueueWithTransaction as addToFocusQueue,
  reorderFocusQueueWithTransaction as reorderFocusQueue,
  removeFromFocusQueueWithTransaction as removeFromFocusQueue } from "@/server/focus-queue";
