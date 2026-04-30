CREATE TABLE "accounts" (
    "id"         TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name"  TEXT NOT NULL,
    "email"      TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "accounts_email_key" ON "accounts"("email");
