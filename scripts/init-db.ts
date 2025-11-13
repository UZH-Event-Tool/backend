import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "User" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "passwordHash" TEXT NOT NULL,
      "fullName" TEXT NOT NULL,
      "firstName" TEXT,
      "lastName" TEXT,
      "dateOfBirth" DATETIME,
      "gender" TEXT,
      "about" TEXT,
      "age" INTEGER,
      "location" TEXT,
      "fieldOfStudies" TEXT,
      "universityEmail" TEXT NOT NULL UNIQUE,
      "interests" TEXT,
      "profileImageUrl" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const columns = await prisma.$queryRaw<
    Array<{ name: string }>
  >`PRAGMA table_info("User")`;
  const columnNames = new Set(columns.map((column) => column.name));

  const columnStatements: Array<{ name: string; sql: string }> = [
    { name: "firstName", sql: `ALTER TABLE "User" ADD COLUMN "firstName" TEXT` },
    { name: "lastName", sql: `ALTER TABLE "User" ADD COLUMN "lastName" TEXT` },
    {
      name: "dateOfBirth",
      sql: `ALTER TABLE "User" ADD COLUMN "dateOfBirth" DATETIME`,
    },
    { name: "gender", sql: `ALTER TABLE "User" ADD COLUMN "gender" TEXT` },
    { name: "about", sql: `ALTER TABLE "User" ADD COLUMN "about" TEXT` },
    { name: "profileImageUrl", sql: `ALTER TABLE "User" ADD COLUMN "profileImageUrl" TEXT` },
  ];

  for (const { name, sql } of columnStatements) {
    if (!columnNames.has(name)) {
      await prisma.$executeRawUnsafe(sql);
    }
  }

  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER IF NOT EXISTS user_updated_at
    AFTER UPDATE ON "User"
    FOR EACH ROW
    BEGIN
      UPDATE "User" SET "updatedAt" = CURRENT_TIMESTAMP WHERE rowid = NEW.rowid;
    END;
  `);

  console.log("SQLite schema ensured.");
}

main()
  .catch((error) => {
    console.error("Failed to initialize database", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
