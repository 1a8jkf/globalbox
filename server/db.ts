import { PrismaClient, Prisma } from "@prisma/client";
export const db = new PrismaClient();
export type Tx = Prisma.TransactionClient;
/** Serializes gameplay mutations across server instances, including geometry checks. */
export async function transact<T>(action: (tx: Tx) => Promise<T>): Promise<T> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(741903)`;
      return action(tx);
    },
    { maxWait: 10000, timeout: 20000 },
  );
}
export class GameError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
export const requireValue = (
  condition: unknown,
  message: string,
  status = 400,
): void => {
  if (!condition) throw new GameError(message, status);
};
