import { readFile } from "node:fs/promises";
import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("database_url_required");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  await pool.query(await readFile(new URL("../db/schema.sql", import.meta.url), "utf8"));
  console.log("Database schema ready.");
} finally { await pool.end(); }
