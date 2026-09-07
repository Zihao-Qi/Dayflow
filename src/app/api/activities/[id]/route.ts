import { evidenceErrors, parseActivityReplaceMutation, readEvidenceMutationBody } from "@/modules/evidence/domain/activity";
import { getPrisma } from "@/lib/prisma";
import { parseWorkflowId } from "@/lib/workflow-mutations";
import { replaceActivity, deleteActivity, evidenceMutationErrorResponse } from "@/server/evidence";
import { NextRequest, NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const id = parseWorkflowId((await params).id, "id", evidenceErrors.activityIdentifierIsInvalid.message);
    const input = parseActivityReplaceMutation(await readEvidenceMutationBody(request));
    return NextResponse.json(await getPrisma().$transaction(tx => replaceActivity(tx, id, input)));
  } catch (error) {
    return evidenceMutationErrorResponse(error, "replace");
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const id = parseWorkflowId((await params).id, "id", evidenceErrors.activityIdentifierIsInvalid.message);
    return NextResponse.json(await getPrisma().$transaction(tx => deleteActivity(tx, id)));
  } catch (error) {
    return evidenceMutationErrorResponse(error, "delete");
  }
}
