import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  deleteProjectSafely,
  getProjectDetail,
  parseProjectStatus
} from "@/lib/projects";
import { parseLocalDate } from "@/lib/dates";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const project = await getProjectDetail(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  return NextResponse.json(project);
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await request.json();
  const data: {
    name?: string;
    desiredOutcome?: string;
    targetDate?: Date | null;
    targetDurationValue?: number | null;
    targetDurationUnit?: "DAYS" | "WEEKS" | null;
    weeklyMinutesBudget?: number | null;
    status?: "ACTIVE" | "PAUSED" | "COMPLETED" | "ARCHIVED";
  } = {};

  if ("name" in body) {
    const name = String(body.name ?? "").trim();
    if (!name) {
      return NextResponse.json({ error: "Project name is required." }, { status: 400 });
    }
    data.name = name;
  }
  if ("desiredOutcome" in body) {
    data.desiredOutcome = String(body.desiredOutcome ?? "").trim();
  }
  if ("targetDate" in body) {
    data.targetDate = body.targetDate ? validDate(body.targetDate) : null;
    if (body.targetDate && !data.targetDate) {
      return NextResponse.json({ error: "Target date is invalid." }, { status: 400 });
    }
  }
  if ("weeklyMinutesBudget" in body) {
    const budget = optionalPositiveInteger(body.weeklyMinutesBudget);
    if (budget === undefined) {
      return NextResponse.json(
        { error: "Weekly effort budget must be a positive number of minutes." },
        { status: 400 }
      );
    }
    data.weeklyMinutesBudget = budget;
  }
  if ("targetDurationValue" in body || "targetDurationUnit" in body) {
    const duration = optionalTargetDuration(
      body.targetDurationValue,
      body.targetDurationUnit
    );
    if (duration === undefined) {
      return NextResponse.json(
        { error: "Target duration needs a positive whole number of days or weeks." },
        { status: 400 }
      );
    }
    data.targetDurationValue = duration?.value ?? null;
    data.targetDurationUnit = duration?.unit ?? null;
  }
  if ("status" in body) {
    const status = parseProjectStatus(body.status);
    if (!status) {
      return NextResponse.json({ error: "Project status is invalid." }, { status: 400 });
    }
    if (status === "COMPLETED" && !body.confirm) {
      const unfinished = await prisma.task.count({
        where: { projectId: id, status: { not: "DONE" } }
      });
      if (unfinished) {
        return NextResponse.json(
          { error: "Confirm completion while unfinished tasks remain.", requiresConfirmation: true },
          { status: 409 }
        );
      }
    }
    data.status = status;
  }

  const existing = await prisma.project.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  await prisma.project.update({ where: { id }, data });
  return NextResponse.json(await getProjectDetail(id));
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params;
  if (request.nextUrl.searchParams.get("confirm") !== "true") {
    return NextResponse.json(
      { error: "Project deletion requires confirmation." },
      { status: 400 }
    );
  }

  const existing = await prisma.project.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  await deleteProjectSafely(id);
  return NextResponse.json({ ok: true });
}

function optionalPositiveInteger(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return undefined;
  return Math.round(number);
}

function validDate(value: unknown) {
  return parseLocalDate(value);
}

function optionalTargetDuration(value: unknown, unit: unknown) {
  if (
    (value === null || value === undefined || value === "") &&
    (unit === null || unit === undefined || unit === "")
  ) {
    return null;
  }
  const number = Number(value);
  const normalizedUnit = String(unit ?? "").toUpperCase();
  if (
    !Number.isInteger(number) ||
    number <= 0 ||
    (normalizedUnit !== "DAYS" && normalizedUnit !== "WEEKS")
  ) {
    return undefined;
  }
  return { value: number, unit: normalizedUnit as "DAYS" | "WEEKS" };
}
