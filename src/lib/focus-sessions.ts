// Compatibility surface; transaction roots live in server and rules in the domain.
export { getFocusSnapshot, startFocusSession, transitionFocusSession } from "@/server/focus";
export { FocusSessionError, FocusSessionConflictError, FocusSessionNotFoundError } from "@/modules/focus/domain/session";
