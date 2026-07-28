import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  EvidenceAttributionError,
  resolveTaskProjectAttribution
} from "@/lib/evidence-attribution";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const noteId = String(body.noteId ?? "").trim() || null;
  if (noteId) {
    const note = await prisma.note.findUnique({
      where: { id: noteId },
      select: { id: true }
    });
    if (!note) {
      return NextResponse.json(
        { error: "The selected Note no longer exists." },
        { status: 400 }
      );
    }
  }
  let attribution;
  try {
    attribution = await resolveTaskProjectAttribution(
      body.taskId,
      body.projectId
    );
  } catch (error) {
    if (error instanceof EvidenceAttributionError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  const material = await prisma.material.create({
    data: {
      title: String(body.title ?? "").trim() || inferTitle(body.url),
      url: String(body.url ?? "").trim(),
      type: body.type ?? inferType(body.url),
      notes: body.notes ?? "",
      taskId: attribution.taskId,
      noteId,
      projectId: attribution.projectId
    }
  });

  return NextResponse.json(material);
}

function inferType(url = "") {
  return url.includes("youtube.com") || url.includes("youtu.be") ? "youtube" : "website";
}

function inferTitle(url = "") {
  return inferType(url) === "youtube" ? "YouTube material" : "Saved material";
}
