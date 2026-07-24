import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getProjectDetail, listProjectSummaries } from "@/lib/projects";
import { parseLocalDate } from "@/lib/dates";

export async function GET() {
  return NextResponse.json(await listProjectSummaries());
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const name = String(body.name ?? "").trim();

  if (!name) {
    return NextResponse.json({ error: "Project name is required." }, { status: 400 });
  }

  const weeklyMinutesBudget = optionalPositiveInteger(body.weeklyMinutesBudget);
  if (weeklyMinutesBudget === undefined) {
    return NextResponse.json(
      { error: "Weekly effort budget must be a positive number of minutes." },
      { status: 400 }
    );
  }
  const targetDuration = optionalTargetDuration(
    body.targetDurationValue,
    body.targetDurationUnit
  );
  if (targetDuration === undefined) {
    return NextResponse.json(
      { error: "Target duration needs a positive whole number of days or weeks." },
      { status: 400 }
    );
  }

  const project = await prisma.project.create({
    data: {
      name,
      desiredOutcome: String(body.desiredOutcome ?? "").trim(),
      targetDate: optionalDate(body.targetDate),
      targetDurationValue: targetDuration?.value ?? null,
      targetDurationUnit: targetDuration?.unit ?? null,
      weeklyMinutesBudget
    }
  });

  return NextResponse.json(await getProjectDetail(project.id), { status: 201 });
}

function optionalPositiveInteger(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return undefined;
  return Math.round(number);
}

function optionalDate(value: unknown) {
  return value ? parseLocalDate(value) : null;
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
