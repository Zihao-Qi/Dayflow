import {
  parseMutationId,
  runOnce
} from "@/server/prisma/run-once";
import {
  parseMaterialCreateInput
} from "@/modules/journal/domain/journal";
import { journalErrors } from "@/modules/journal/domain/journal";
import { createMaterial, readJournalHistory, journalErrorResponse } from "@/server/journal";
import { getPrisma } from "@/lib/prisma";
import { AppError } from "@/shared/kernel/errors";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    return NextResponse.json(
      await readJournalHistory(getPrisma(), "material", request.nextUrl.searchParams)
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
    const material = await runOnce({
      mutationId,
      kind: "material.create",
      payload: body,
      create: (transaction) => createMaterial(transaction, input)
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
