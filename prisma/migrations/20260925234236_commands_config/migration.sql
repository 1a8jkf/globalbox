-- AlterTable
ALTER TABLE "GameConfig" ADD COLUMN     "resourcePrices" JSONB NOT NULL DEFAULT '{"Food":1,"Wood":2,"Stone":3,"Metal":5,"Energy":2}';

-- CreateTable
CREATE TABLE "CommandReceipt" (
    "userId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommandReceipt_pkey" PRIMARY KEY ("userId","requestId")
);
