-- Storico sessioni di import consuntivi da Zoho Projects: chi ha importato,
-- quando, e i delta applicati alle attività (snapshot JSON in `righe`).
-- Additivo. Le sessioni più vecchie di 5 giorni vengono ripulite dall'API.

-- CreateTable
CREATE TABLE "zoho_import_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "righe" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zoho_import_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "zoho_import_sessions_created_at_idx" ON "zoho_import_sessions"("created_at");

-- AddForeignKey
ALTER TABLE "zoho_import_sessions" ADD CONSTRAINT "zoho_import_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
