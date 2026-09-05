import { appErrorConstructor } from "@/lib/error-compat";
import { idempotencyErrors } from "@/lib/idempotency-errors";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/shared/kernel/errors";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";

export const DAYFLOW_MUTATION_ID_MAX_LENGTH = 128;

/** @deprecated Compatibility constructor for existing callers; returns AppError. */
export const IdempotentMutationError = appErrorConstructor(
  (
    code: "INVALID_MUTATION_ID" | "MUTATION_ID_CONFLICT" | "INVALID_MUTATION_RECEIPT",
    message: string,
    status: 400 | 409 | 500
  ) => new AppError({ status, message, code }),
  (error) => ["INVALID_MUTATION_ID", "MUTATION_ID_CONFLICT", "INVALID_MUTATION_RECEIPT"].includes(error.code ?? "")
);
export type IdempotentMutationError = AppError;

export function parseMutationId(value: string | null) {
  if (value === null) return null;
  const mutationId = value.trim();
  if (
    !mutationId ||
    mutationId.length > DAYFLOW_MUTATION_ID_MAX_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(mutationId)
  ) {
    throw new AppError(idempotencyErrors.xDayflowMutationIdMustContain1To128Characters);
  }
  return mutationId;
}

export function mutationRequestHash(kind: string, payload: unknown) {
  return createHash("sha256")
    .update(`${kind}\n${stableStringify(payload)}`)
    .digest("hex");
}

export async function runIdempotentCreate<T>({
  mutationId,
  kind,
  payload,
  create
}: {
  mutationId: string | null;
  kind: string;
  payload: unknown;
  create: (transaction: Prisma.TransactionClient) => Promise<T>;
}): Promise<T> {
  if (!mutationId) {
    return prisma.$transaction((transaction) => create(transaction));
  }

  const requestHash = mutationRequestHash(kind, payload);
  try {
    return await prisma.$transaction(async (transaction) => {
      const receipt = await transaction.mutationReceipt.findUnique({
        where: { id: mutationId }
      });
      if (receipt) {
        return decodeReceipt<T>(receipt, kind, requestHash);
      }

      const result = await create(transaction);
      await transaction.mutationReceipt.create({
        data: {
          id: mutationId,
          kind,
          requestHash,
          responseJson: JSON.stringify(result)
        }
      });
      return result;
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const receipt = await prisma.mutationReceipt.findUnique({
        where: { id: mutationId }
      });
      if (receipt) return decodeReceipt<T>(receipt, kind, requestHash);
    }
    throw error;
  }
}

function decodeReceipt<T>(
  receipt: {
    kind: string;
    requestHash: string;
    responseJson: string;
  },
  expectedKind: string,
  expectedHash: string
) {
  if (
    receipt.kind !== expectedKind ||
    receipt.requestHash !== expectedHash
  ) {
    throw new AppError(idempotencyErrors.thisMutationIdentifierWasAlreadyUsedForADifferentRequest);
  }
  try {
    return JSON.parse(receipt.responseJson) as T;
  } catch {
    throw new AppError(idempotencyErrors.theSavedMutationReceiptCouldNotBeRead);
  }
}

function stableStringify(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .filter((key) => object[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  return serialized === undefined ? "null" : serialized;
}
