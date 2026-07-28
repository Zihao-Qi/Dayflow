import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  IdempotentMutationError,
  parseMutationId,
  runIdempotentCreate
} from "@/lib/idempotent-mutations";
import {
  encodeJournalCursor,
  JournalRequestError,
  parseJournalPage,
  parseNoteCreateInput,
  parseStoredTags
} from "@/lib/journal-domain";
import { resolveJournalAttribution } from "@/lib/journal-relations";

export async function GET(request: NextRequest) {
  try {
    const { limit, cursor } = parseJournalPage(
      request.nextUrl.searchParams,
      "note"
    );
    const [records, totalCount] = await prisma.$transaction([
      prisma.note.findMany({
        where: cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                {
                  createdAt: cursor.createdAt,
                  id: { lt: cursor.id }
                }
              ]
            }
          : undefined,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1
      }),
      prisma.note.count()
    ]);
    const hasMore = records.length > limit;
    const notes = records.slice(0, limit).map((note) => ({
      ...note,
      tags: parseStoredTags(note.tags)
    }));
    const last = hasMore ? records[limit - 1] : null;

    return NextResponse.json({
      items: notes,
      nextCursor: last ? encodeJournalCursor("note", last) : null,
      totalCount
    });
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
