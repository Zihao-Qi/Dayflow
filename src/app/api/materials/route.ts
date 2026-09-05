import {
  parseMutationId,
  runIdempotentCreate
} from "@/lib/idempotent-mutations";
import {
  parseMaterialCreateInput
} from "@/lib/journal-domain";
import { journalErrors } from "@/lib/journal-errors";
import { readJournalHistory } from "@/lib/journal-history";
import { journalErrorResponse } from "@/lib/journal-http";
import { resolveMaterialRelations } from "@/lib/journal-relations";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/shared/kernel/errors";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    return NextResponse.json(
      await readJournalHistory(prisma, "material", request.nextUrl.searchParams)
    );
  } catch (error) {
    return journalErrorResponse(error, journalErrors.referencesCouldNotBeLoaded);
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
    return journalErrorResponse(error, journalErrors.theReferenceCouldNotBeSaved);
  }
}

async function parseJson(request: NextRequest) {
  try {
    return await request.json();
  } catch {
    throw new AppError(journalErrors.requestBodyMustBeValidJSON);
  }
}
