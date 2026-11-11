-- Add slug column to StudyPackage
ALTER TABLE "public"."StudyPackage" ADD COLUMN "slug" TEXT;

-- CreateIndex for slug uniqueness
CREATE UNIQUE INDEX "StudyPackage_slug_key" ON "public"."StudyPackage"("slug" ASC);

-- CreateTable PackageEdition
CREATE TABLE "public"."PackageEdition" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "levelId" TEXT NOT NULL,
    "year" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "sourceUrl" TEXT,
    "snapshotDate" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "PackageEdition_pkey" PRIMARY KEY ("id")
);

-- CreateTable PackageUnit
CREATE TABLE "public"."PackageUnit" (
    "id" TEXT NOT NULL,
    "editionId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "providerLabel" TEXT,
    "title" TEXT,
    "topicLabel" TEXT,
    "sourceUrl" TEXT,
    "notesPageStart" INTEGER,
    "notesPageCount" INTEGER,

    CONSTRAINT "PackageUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable PackageResource
CREATE TABLE "public"."PackageResource" (
    "id" TEXT NOT NULL,
    "editionId" TEXT NOT NULL,
    "unitId" TEXT,
    "ref" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT,
    "externalId" TEXT,
    "sourceUrl" TEXT,
    "sizeKb" INTEGER,
    "durationSeconds" INTEGER,
    "pageStart" INTEGER,
    "pageCount" INTEGER,
    "wordCount" INTEGER,
    "questionCount" INTEGER,
    "vignetteCount" INTEGER,
    "calcCount" INTEGER,
    "stmtCount" INTEGER,
    "exhibitCount" INTEGER,
    "sourceNote" TEXT,

    CONSTRAINT "PackageResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable PackageUnitReading
CREATE TABLE "public"."PackageUnitReading" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "readingId" TEXT NOT NULL,
    "coverage" TEXT NOT NULL DEFAULT 'full',
    "note" TEXT,

    CONSTRAINT "PackageUnitReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable PackageUnitLos
CREATE TABLE "public"."PackageUnitLos" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "sourceLabel" TEXT NOT NULL,
    "losId" TEXT,
    "questionCount" INTEGER,
    "retired" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,

    CONSTRAINT "PackageUnitLos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PackageEdition_packageId_levelId_year_key" ON "public"."PackageEdition"("packageId" ASC, "levelId" ASC, "year" ASC);

-- CreateIndex
CREATE INDEX "PackageEdition_ownerUserId_idx" ON "public"."PackageEdition"("ownerUserId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "PackageUnit_editionId_ref_key" ON "public"."PackageUnit"("editionId" ASC, "ref" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "PackageUnit_editionId_order_key" ON "public"."PackageUnit"("editionId" ASC, "order" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "PackageResource_editionId_ref_key" ON "public"."PackageResource"("editionId" ASC, "ref" ASC);

-- CreateIndex
CREATE INDEX "PackageResource_unitId_kind_idx" ON "public"."PackageResource"("unitId" ASC, "kind" ASC);

-- CreateIndex
CREATE INDEX "PackageResource_externalId_idx" ON "public"."PackageResource"("externalId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "PackageUnitReading_unitId_readingId_key" ON "public"."PackageUnitReading"("unitId" ASC, "readingId" ASC);

-- CreateIndex
CREATE INDEX "PackageUnitReading_readingId_idx" ON "public"."PackageUnitReading"("readingId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "PackageUnitLos_unitId_sourceLabel_key" ON "public"."PackageUnitLos"("unitId" ASC, "sourceLabel" ASC);

-- CreateIndex
CREATE INDEX "PackageUnitLos_losId_idx" ON "public"."PackageUnitLos"("losId" ASC);

-- AddForeignKey
ALTER TABLE "public"."PackageEdition" ADD CONSTRAINT "PackageEdition_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "public"."StudyPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PackageEdition" ADD CONSTRAINT "PackageEdition_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "public"."Level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PackageUnit" ADD CONSTRAINT "PackageUnit_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "public"."PackageEdition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PackageResource" ADD CONSTRAINT "PackageResource_editionId_fkey" FOREIGN KEY ("editionId") REFERENCES "public"."PackageEdition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PackageResource" ADD CONSTRAINT "PackageResource_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "public"."PackageUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PackageUnitReading" ADD CONSTRAINT "PackageUnitReading_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "public"."PackageUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PackageUnitReading" ADD CONSTRAINT "PackageUnitReading_readingId_fkey" FOREIGN KEY ("readingId") REFERENCES "public"."Reading"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PackageUnitLos" ADD CONSTRAINT "PackageUnitLos_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "public"."PackageUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PackageUnitLos" ADD CONSTRAINT "PackageUnitLos_losId_fkey" FOREIGN KEY ("losId") REFERENCES "public"."LOS"("id") ON DELETE SET NULL ON UPDATE CASCADE;
