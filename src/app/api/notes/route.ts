import { clock } from "@/lib/time";
import {
  parseMutationId,
  runOnce
} from "@/server/prisma/run-once";
import {
  parseNoteCreateInput,
  parseStoredTags
} from "@/modules/journal/domain/journal";
import { journalErrors } from "@/modules/journal/domain/journal";
import { createNote, readJournalHistory, journalErrorResponse } from "@/server/journal";
import { getPrisma } from "@/lib/prisma";
import { AppError } from "@/shared/kernel/errors";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    return NextResponse.json(
      await readJournalHistory(getPrisma(), "note", request.nextUrl.searchParams)
    );
  } catch (error) {
    return journalErrorResponse(error, journalErrors.notesCouldNotBeLoaded);
  }
}

export async function POST(request: NextRequest) {
  const now = clock.now();
  try {
    const mutationId = parseMutationId(
      request.headers.get("X-Dayflow-Mutation-Id")
    );
    const body = await parseJson(request);
    const input = parseNoteCreateInput(body, now);
    const note = await runOnce({
      mutationId,
      kind: "note.create",
      payload: body,
      create: (transaction) => createNote(transaction, input)
    });

    return NextResponse.json(
      { ...note, tags: parseStoredTags(note.tags) },
      { status: 201 }
    );
  } catch (error) {
    return journalErrorResponse(error, journalErrors.theNoteCouldNotBeSaved);
  }
}

async function parseJson(request: NextRequest) {
  try {
    return await request.json();
  } catch {
    throw new AppError(journalErrors.requestBodyMustBeValidJSON);
  }
}
