import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const DAYFLOW_MUTATION_ID_MAX_LENGTH = 128;

export class IdempotentMutationError extends Error {
  constructor(
    readonly code:
      | "INVALID_MUTATION_ID"
      | "MUTATION_ID_CONFLICT"
      | "INVALID_MUTATION_RECEIPT",
    message: string,
    readonly status: 400 | 409 | 500
  ) {
    super(message);
    this.name = "IdempotentMutationError";
  }
}

export function parseMutationId(value: string | null) {
  if (value === null) return null;
  const mutationId = value.trim();
  if (
    !mutationId ||
    mutationId.length > DAYFLOW_MUTATION_ID_MAX_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(mutationId)
  ) {
    throw new IdempotentMutationError(
      "INVALID_MUTATION_ID",
      `X-Dayflow-Mutation-Id must contain 1 to ${DAYFLOW_MUTATION_ID_MAX_LENGTH} characters.`,
      400
    );
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
    throw new IdempotentMutationError(
      "MUTATION_ID_CONFLICT",
      "This mutation identifier was already used for a different request.",
      409
    );
  }
  try {
    return JSON.parse(receipt.responseJson) as T;
  } catch {
    throw new IdempotentMutationError(
      "INVALID_MUTATION_RECEIPT",
      "The saved mutation receipt could not be read.",
      500
    );
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
