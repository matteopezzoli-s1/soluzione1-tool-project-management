-- CreateTable
CREATE TABLE "project_managers" (
    "id"         TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name"  TEXT NOT NULL,
    "email"      TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_managers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_managers_email_key" ON "project_managers"("email");
