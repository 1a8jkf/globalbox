import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { requireValue, type Tx } from "./db.ts";
export async function once<T>(
  tx: Tx,
  userId: string,
  requestId: string,
  payload: unknown,
  execute: () => Promise<T>,
): Promise<T> {
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
  const prior = await tx.commandReceipt.findUnique({
    where: { userId_requestId: { userId, requestId } },
  });
  if (prior) {
    requireValue(
      prior.fingerprint === fingerprint,
      "Identificador já utilizado em outro comando.",
      409,
    );
    return prior.result as T;
  }
  const result = await execute();
  await tx.commandReceipt.create({
    data: {
      userId,
      requestId,
      fingerprint,
      result: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue,
    },
  });
  return result;
}
