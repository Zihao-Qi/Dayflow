import type { ErrorSpec } from "@/shared/kernel/errors";

/** Exact envelopes owned by the focus boundary. Property order is wire order. */
export const focusErrors = {
  timerDurationMustBeBetween1And240Minutes: {
    status: 400,
    message: "Timer duration must be between 1 and 240 minutes.",
    code: "VALIDATION_ERROR"
  },
  finishOrCancelTheActiveTimerFirst: {
    status: 409,
    message: "Finish or cancel the active timer first.",
    code: "CONFLICT"
  },
  theSelectedTaskCouldNotBeFound: {
    status: 404,
    message: "The selected task could not be found.",
    code: "NOT_FOUND"
  },
  theSelectedTaskBelongsToADifferentProject: {
    status: 409,
    message: "The selected task belongs to a different project.",
    code: "CONFLICT"
  },
  theSelectedProjectCouldNotBeFound: {
    status: 404,
    message: "The selected project could not be found.",
    code: "NOT_FOUND"
  },
  focusSessionNotFound: {
    status: 404,
    message: "Focus session not found.",
    code: "NOT_FOUND",
    field: "id"
  },
  onlyARunningTimerCanBePaused: {
    status: 409,
    message: "Only a running timer can be paused.",
    code: "CONFLICT"
  },
  onlyAPausedTimerCanBeResumed: {
    status: 409,
    message: "Only a paused timer can be resumed.",
    code: "CONFLICT"
  },
  thisTimerIsNoLongerActive: {
    status: 409,
    message: "This timer is no longer active.",
    code: "CONFLICT"
  },
  onlyACompletedFocusBlockCanBeEnriched: {
    status: 409,
    message: "Only a completed focus block can be enriched.",
    code: "CONFLICT"
  },
  unknownTimerAction: {
    status: 400,
    message: "Unknown timer action.",
    code: "VALIDATION_ERROR"
  },
  timerKindMustBeFOCUSOrBREAK: {
    status: 400,
    message: "Timer kind must be FOCUS or BREAK.",
    code: "VALIDATION_ERROR"
  },
  thisTimerWasUpdatedInAnotherTabRefreshAndTryAgain: {
    status: 409,
    message: "This timer was updated in another tab. Refresh and try again.",
    code: "CONFLICT"
  },
  theFocusSessionChangedBeforeItCouldBeSaved: {
    status: 409,
    message: "The Focus session changed before it could be saved.",
    code: "CONFLICT"
  },
  focusTimerCouldNotBeSaved: {
    status: 500,
    message: "Focus timer could not be saved.",
    code: "INTERNAL_ERROR"
  },
  focusTimerCouldNotBeLoaded: {
    status: 500,
    message: "Focus timer could not be loaded.",
    code: "INTERNAL_ERROR"
  },
  aSelectedFocusRelationshipChangedBeforeTheTimerStarted: {
    status: 409,
    message: "A selected Focus relationship changed before the timer started.",
    code: "CONFLICT"
  },
  focusTimerCouldNotBeStarted: {
    status: 500,
    message: "Focus timer could not be started.",
    code: "INTERNAL_ERROR"
  }
} as const satisfies Record<string, ErrorSpec>;
