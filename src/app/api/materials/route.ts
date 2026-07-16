import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const material = await prisma.material.create({
    data: {
      title: String(body.title ?? "").trim() || inferTitle(body.url),
      url: String(body.url ?? "").trim(),
      type: body.type ?? inferType(body.url),
      notes: body.notes ?? "",
      taskId: body.taskId || null,
      noteId: body.noteId || null
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
