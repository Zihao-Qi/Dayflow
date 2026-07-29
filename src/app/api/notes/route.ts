import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  IdempotentMutationError,
  parseMutationId,
  runIdempotentCreate
} from "@/lib/idempotent-mutations";
import {
  JournalRequestError,
  parseNoteCreateInput,
  parseStoredTags
} from "@/lib/journal-domain";
import { readJournalHistory } from "@/lib/journal-history";
import { resolveJournalAttribution } from "@/lib/journal-relations";

export async function GET(request: NextRequest) {
  try {
    return NextResponse.json(
      await readJournalHistory(prisma, "note", request.nextUrl.searchParams)
    );
  } catch (error) {
    return journalErrorResponse(error, "Notes could not be loaded.");
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
    return journalErrorResponse(error, "The note could not be saved.");
  }
}

async function parseJson(request: NextRequest) {
  try {
    return await request.json();
  } catch {
    throw new JournalRequestError(
      "INVALID_JSON",
      "Request body must be valid JSON."
    );
  }
}

function journalErrorResponse(error: unknown, fallback: string) {
  if (error instanceof IdempotentMutationError) {
    return NextResponse.json(
      { code: error.code, error: error.message },
      { status: error.status }
    );
  }
  if (error instanceof JournalRequestError) {
    return NextResponse.json(
      { code: error.code, error: error.message },
      { status: error.status }
    );
  }
  console.error(fallback, error);
  return NextResponse.json(
    { code: "INTERNAL_ERROR", error: fallback },
    { status: 500 }
  );
}
