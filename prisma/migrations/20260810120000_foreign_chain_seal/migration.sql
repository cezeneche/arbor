-- The Nucleos CBAM audit chain stopped accepting writes at Phase 4, and its
-- entries were deliberately not imported.
--
-- Recording the seal is what separates "that chain ended here, and we know its
-- final state" from "that chain is missing". Without it, the absence of Nucleos
-- entries in Arbor's chain would be indistinguishable from their deletion —
-- which is precisely the distinction the audit chain exists to support.

CREATE TABLE "ForeignChainSeal" (
    "id" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "entryCount" INTEGER NOT NULL,
    "firstEventAt" TIMESTAMP(3),
    "lastEventAt" TIMESTAMP(3),
    "finalSignature" TEXT,
    "sealHash" TEXT NOT NULL,
    "sealedAt" TIMESTAMP(3) NOT NULL,
    "importedIntoArbor" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForeignChainSeal_pkey" PRIMARY KEY ("id")
);

-- One seal per origin: a chain ends once. A second row for the same origin would
-- mean either a re-seal after further writes, which contradicts sealing, or a
-- duplicate import — both worth failing on rather than storing.
CREATE UNIQUE INDEX "ForeignChainSeal_origin_key" ON "ForeignChainSeal"("origin");
