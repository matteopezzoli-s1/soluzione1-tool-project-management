-- CreateEnum
CREATE TYPE "TipoAttivita" AS ENUM ('STANDARD', 'BUCKET');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "deleted_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "attivita" ADD COLUMN     "tipo" "TipoAttivita" NOT NULL DEFAULT 'STANDARD',
ADD COLUMN     "giornate_fatturate" DECIMAL(10,2);
