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
  parseMaterialCreateInput
} from "@/lib/journal-domain";
import { resolveMaterialRelations } from "@/lib/journal-relations";

export async function GET(request: NextRequest) {
  try {
    const { limit, cursor } = parseJournalPage(
      request.nextUrl.searchParams,
      "material"
    );
    const [records, totalCount] = await prisma.$transaction([
      prisma.material.findMany({
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
      prisma.material.count()
    ]);
    const hasMore = records.length > limit;
    const materials = records.slice(0, limit);
    const last = hasMore ? records[limit - 1] : null;

    return NextResponse.json({
      items: materials,
      nextCursor: last ? encodeJournalCursor("material", last) : null,
      totalCount
    });
  } catch (error) {
    return journalErrorResponse(error, "References could not be loaded.");
  }
}

export async function POST(request: NextRequest) {
  try {
    const mutationId = parseMutationId(
      request.headers.get("X-Dayflow-Mutation-Id")
    );
    const body = await parseJson(request);
    const input = parseMaterialCreateInput(body);
    const material = await runIdempotentCreate({
      mutationId,
      kind: "material.create",
      payload: body,
      create: async (transaction) => {
        const relations = await resolveMaterialRelations(transaction, input);
        return transaction.material.create({
          data: {
            title: input.title,
            url: input.url,
            type: input.type,
            notes: input.notes,
            taskId: relations.taskId,
            noteId: relations.noteId,
            projectId: relations.projectId
          }
        });
      }
    });

    return NextResponse.json(material, { status: 201 });
  } catch (error) {
    return journalErrorResponse(error, "The reference could not be saved.");
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
