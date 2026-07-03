-- Upgrade 4 (property graph). Additive only: a derived graph projection of the
-- relational store (nodes + edges). Rebuilt off the write path; not a source of
-- truth for certified data, so no FK back to Entity/Document/DataRecord.

-- CreateEnum
CREATE TYPE "GraphNodeType" AS ENUM ('ENTITY', 'DOCUMENT', 'RECORD');

-- CreateEnum
CREATE TYPE "GraphEdgeType" AS ENUM ('SUBMITTED', 'OWNS', 'YIELDED', 'SAME_AS', 'SUPPLIES');

-- CreateTable
CREATE TABLE "GraphNode" (
    "id" TEXT NOT NULL,
    "type" "GraphNodeType" NOT NULL,
    "refId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "props" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GraphNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GraphEdge" (
    "id" TEXT NOT NULL,
    "type" "GraphEdgeType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GraphEdge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GraphNode_type_refId_idx" ON "GraphNode"("type", "refId");

-- CreateIndex
CREATE INDEX "GraphEdge_sourceId_type_idx" ON "GraphEdge"("sourceId", "type");

-- CreateIndex
CREATE INDEX "GraphEdge_targetId_type_idx" ON "GraphEdge"("targetId", "type");

-- CreateIndex
CREATE INDEX "GraphEdge_type_idx" ON "GraphEdge"("type");

-- AddForeignKey
ALTER TABLE "GraphEdge" ADD CONSTRAINT "GraphEdge_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "GraphNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphEdge" ADD CONSTRAINT "GraphEdge_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "GraphNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
