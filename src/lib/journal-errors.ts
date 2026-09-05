import { AppError, type ErrorSpec } from "@/shared/kernel/errors";

/** Exact envelopes owned by the journal boundary. The serializer emits exactly the declared properties. */
export const journalErrors = {
  provideOnlyOnePageLimit: {
    status: 400,
    code: "VALIDATION_ERROR",
    message: "Provide only one page limit."
  },
  pageLimitMustBeAPositiveWholeNumber: {
    status: 400,
    code: "VALIDATION_ERROR",
    message: "Page limit must be a positive whole number."
  },
  provideOnlyOnePaginationCursor: {
    status: 400,
    code: "INVALID_CURSOR",
    message: "Provide only one pagination cursor."
  },
  thePaginationCursorIsInvalid: {
    status: 400,
    code: "INVALID_CURSOR",
    message: "The pagination cursor is invalid."
  },
  noteTagsMustBeAnArrayOfTextValues: {
    status: 400,
    code: "VALIDATION_ERROR",
    message: "Note tags must be an array of text values."
  },
  aNoteCanHaveAtMost20Tags: {
    status: 400,
    code: "VALIDATION_ERROR",
    message: "A note can have at most 20 tags."
  },
  noteTagsMustContainOnlyTextValues: {
    status: 400,
    code: "VALIDATION_ERROR",
    message: "Note tags must contain only text values."
  },
  eachNoteTagMustBe50CharactersOrFewer: {
    status: 400,
    code: "VALIDATION_ERROR",
    message: "Each note tag must be 50 characters or fewer."
  },
  materialURLMustBeAValidHttpOrHttpsURL: {
    status: 400,
    code: "VALIDATION_ERROR",
    message: "Material URL must be a valid http or https URL."
  },
  provideOnlyOneJournalSearchQuery: {
    status: 400,
    code: "VALIDATION_ERROR",
    message: "Provide only one Journal search query."
  },
  journalSearchMustBe200CharactersOrFewer: {
    status: 400,
    code: "VALIDATION_ERROR",
    message: "Journal search must be 200 characters or fewer."
  },
  journalSearchCannotContainControlCharacters: {
    status: 400,
    code: "VALIDATION_ERROR",
    message: "Journal search cannot contain control characters."
  },
  provideOnlyOneNoteTagFilter: {
    status: 400,
    code: "VALIDATION_ERROR",
    message: "Provide only one Note tag filter."
  },
  tagFilteringIsAvailableOnlyForNotes: {
    status: 400,
    code: "VALIDATION_ERROR",
    message: "Tag filtering is available only for Notes."
  },
  theLinkedTaskCouldNotBeFound: {
    status: 404,
    code: "RELATIONSHIP_NOT_FOUND",
    message: "The linked task could not be found."
  },
  theLinkedProjectCouldNotBeFound: {
    status: 404,
    code: "RELATIONSHIP_NOT_FOUND",
    message: "The linked project could not be found."
  },
  theSelectedTaskBelongsToADifferentProject: {
    status: 409,
    code: "ATTRIBUTION_CONFLICT",
    message: "The selected task belongs to a different project."
  },
  theLinkedNoteCouldNotBeFound: {
    status: 404,
    code: "RELATIONSHIP_NOT_FOUND",
    message: "The linked note could not be found."
  },
  theSelectedNoteBelongsToADifferentProject: {
    status: 409,
    code: "ATTRIBUTION_CONFLICT",
    message: "The selected note belongs to a different project."
  },
  requestBodyMustBeValidJSON: {
    status: 400,
    code: "INVALID_JSON",
    message: "Request body must be valid JSON."
  },
  xDayflowMutationIdMustContain1To128Characters: {
    status: 400,
    code: "INVALID_MUTATION_ID",
    message: "X-Dayflow-Mutation-Id must contain 1 to 128 characters."
  },
  thisMutationIdentifierWasAlreadyUsedForADifferentRequest: {
    status: 409,
    code: "MUTATION_ID_CONFLICT",
    message: "This mutation identifier was already used for a different request."
  },
  theSavedMutationReceiptCouldNotBeRead: {
    status: 500,
    code: "INVALID_MUTATION_RECEIPT",
    message: "The saved mutation receipt could not be read."
  },
  notesCouldNotBeLoaded: {
    status: 500,
    code: "INTERNAL_ERROR",
    message: "Notes could not be loaded."
  },
  referencesCouldNotBeLoaded: {
    status: 500,
    code: "INTERNAL_ERROR",
    message: "References could not be loaded."
  },
  theNoteCouldNotBeSaved: {
    status: 500,
    code: "INTERNAL_ERROR",
    message: "The note could not be saved."
  },
  theReferenceCouldNotBeSaved: {
    status: 500,
    code: "INTERNAL_ERROR",
    message: "The reference could not be saved."
  },
  writeSomethingBeforeSavingThisNote: {
    status: 400,
    code: "VALIDATION_ERROR",
    message: "Write something before saving this note."
  },
  addAURLBeforeSavingThisReference: {
    status: 400,
    code: "VALIDATION_ERROR",
    message: "Add a URL before saving this reference."
  }
} as const satisfies Record<string, ErrorSpec>;

/** Receipt semantics belong to idempotency; Journal owns its code-first variants. */
export function journalAppError(error: AppError): AppError {
  switch (error.code) {
    case "INVALID_MUTATION_ID": return new AppError(journalErrors.xDayflowMutationIdMustContain1To128Characters, error);
    case "MUTATION_ID_CONFLICT": return new AppError(journalErrors.thisMutationIdentifierWasAlreadyUsedForADifferentRequest, error);
    case "INVALID_MUTATION_RECEIPT": return new AppError(journalErrors.theSavedMutationReceiptCouldNotBeRead, error);
    default: return error;
  }
}
