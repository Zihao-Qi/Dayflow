import {
  parseMutationId,
  runIdempotentCreate
} from "@/lib/idempotent-mutations";
import {
  parseNoteCreateInput,
  parseStoredTags
} from "@/lib/journal-domain";
import { journalErrors } from "@/lib/journal-errors";
import { readJournalHistory } from "@/lib/journal-history";
import { journalErrorResponse } from "@/lib/journal-http";
import { resolveJournalAttribution } from "@/lib/journal-relations";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/shared/kernel/errors";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    return NextResponse.json(
      await readJournalHistory(prisma, "note", request.nextUrl.searchParams)
    );
  } catch (error) {
    return journalErrorResponse(error, journalErrors.notesCouldNotBeLoaded);
  }
}

export async function POST(request: NextRequest) {
  try {
    const mutationId = parseMutationId(
      request.headers.get("X-Dayflow-Mutation-Id")
    );
    const body = await parseJson(request);
    const input = parseNoteCreateInput(body);
    const note = await runIdempotentCreate({
      mutationId,
      kind: "note.create",
      payload: body,
      create: async (transaction) => {
        const attribution = await resolveJournalAttribution(transaction, input);
        return transaction.note.create({
          data: {
            content: input.content,
            tags: JSON.stringify(input.tags),
            taskId: attribution.taskId,
            projectId: attribution.projectId,
            date: input.date
          }
        });
      }
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
