import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const projectId = String(body.projectId ?? "").trim() || null;
  if (projectId) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true }
    });
    if (!project) {
      return NextResponse.json({ error: "The linked project could not be found." }, { status: 400 });
    }
  }

  const material = await prisma.material.create({
    data: {
      title: String(body.title ?? "").trim() || inferTitle(body.url),
      url: String(body.url ?? "").trim(),
      type: body.type ?? inferType(body.url),
      notes: body.notes ?? "",
      taskId: body.taskId || null,
      noteId: body.noteId || null,
      projectId
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
