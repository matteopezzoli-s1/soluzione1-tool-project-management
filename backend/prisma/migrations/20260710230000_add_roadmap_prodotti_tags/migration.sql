-- AlterTable
ALTER TABLE "progetti" ADD COLUMN     "colore" TEXT,
ADD COLUMN     "po_id" TEXT,
ADD COLUMN     "tipo" TEXT NOT NULL DEFAULT 'CLIENTE';

-- CreateTable
CREATE TABLE "stato_roadmap_config" (
    "id" TEXT NOT NULL,
    "chiave" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "colore" TEXT NOT NULL DEFAULT '#94a3b8',
    "is_archiviato" BOOLEAN NOT NULL DEFAULT false,
    "ordine" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stato_roadmap_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roadmap_items" (
    "id" TEXT NOT NULL,
    "progetto_id" TEXT NOT NULL,
    "anno" INTEGER NOT NULL,
    "quarter" TEXT,
    "data_deadline" TIMESTAMP(3),
    "titolo" TEXT NOT NULL,
    "descrizione" TEXT,
    "stato" TEXT NOT NULL DEFAULT 'DA_FARE',
    "analisi_url" TEXT,
    "stima_gg" DECIMAL(10,2),
    "ordine" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roadmap_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roadmap_tags" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "colore" TEXT NOT NULL DEFAULT '#94a3b8',
    "ordine" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roadmap_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roadmap_item_tags" (
    "roadmap_item_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,

    CONSTRAINT "roadmap_item_tags_pkey" PRIMARY KEY ("roadmap_item_id","tag_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stato_roadmap_config_chiave_key" ON "stato_roadmap_config"("chiave");

-- CreateIndex
CREATE INDEX "roadmap_items_progetto_id_idx" ON "roadmap_items"("progetto_id");

-- CreateIndex
CREATE INDEX "roadmap_items_anno_quarter_idx" ON "roadmap_items"("anno", "quarter");

-- CreateIndex
CREATE INDEX "roadmap_items_stato_idx" ON "roadmap_items"("stato");

-- CreateIndex
CREATE UNIQUE INDEX "roadmap_tags_label_key" ON "roadmap_tags"("label");

-- CreateIndex
CREATE INDEX "progetti_tipo_idx" ON "progetti"("tipo");

-- AddForeignKey
ALTER TABLE "progetti" ADD CONSTRAINT "progetti_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "project_managers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roadmap_items" ADD CONSTRAINT "roadmap_items_progetto_id_fkey" FOREIGN KEY ("progetto_id") REFERENCES "progetti"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roadmap_item_tags" ADD CONSTRAINT "roadmap_item_tags_roadmap_item_id_fkey" FOREIGN KEY ("roadmap_item_id") REFERENCES "roadmap_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roadmap_item_tags" ADD CONSTRAINT "roadmap_item_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "roadmap_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

