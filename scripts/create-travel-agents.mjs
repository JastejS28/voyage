/**
 * scripts/create-travel-agents.mjs
 *
 * Creates the travel_agents table in the friend's NeonDB.
 * Run once: node scripts/create-travel-agents.mjs
 */

import { neon } from "@neondatabase/serverless"

const DATABASE_URL =
  "postgresql://neondb_owner:npg_PVRKsBMtL7E3@ep-holy-shape-aiivrt7c-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"

const sql = neon(DATABASE_URL)

console.log("Creating travel_agents table...")

await sql`
  CREATE TABLE IF NOT EXISTS travel_agents (
    agent_id     UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    stackauth_id VARCHAR     NOT NULL UNIQUE,
    name         VARCHAR,
    email        VARCHAR,
    role         VARCHAR     NOT NULL DEFAULT 'agent',
    created_at   TIMESTAMP   NOT NULL DEFAULT NOW()
  )
`

console.log("✅ travel_agents table created (or already exists).")

// Verify
const rows = await sql`
  SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'travel_agents'
  ORDER BY ordinal_position
`

console.log("\nColumns:")
for (const col of rows) {
  console.log(
    `  ${col.column_name.padEnd(16)} ${col.data_type.padEnd(20)} ${col.is_nullable === "YES" ? "NULL" : "NOT NULL"}${col.column_default ? "  DEFAULT: " + col.column_default : ""}`
  )
}
