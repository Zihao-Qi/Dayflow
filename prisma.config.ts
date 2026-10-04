import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";
import { prismaDatasourceUrl } from "./src/lib/prisma-config";

const repositoryRoot = dirname(fileURLToPath(import.meta.url));
// Explicit environment takes precedence over .env; neither path opens SQLite.
const databaseUrl = prismaDatasourceUrl(repositoryRoot, process.env);

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Generation needs no connection URL. Database commands must fail without
  // one, rather than quietly choosing a fallback database.
  ...(databaseUrl ? {
    datasource: { url: databaseUrl }
  } : {})
});
