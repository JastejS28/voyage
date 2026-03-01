/**
 * scripts/inspect-schema.mjs
 *
 * Connects to the NeonDB and prints a full schema dump:
 *   - All tables (with schema)
 *   - All columns per table (name, type, nullable, default)
 *   - Primary keys
 *   - Foreign keys
 *   - Indexes
 *
 * Run:
 *   node scripts/inspect-schema.mjs
 */

import { neon } from "@neondatabase/serverless"

const DATABASE_URL =
  "postgresql://neondb_owner:npg_PVRKsBMtL7E3@ep-holy-shape-aiivrt7c-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"

const sql = neon(DATABASE_URL)

// ─── Helpers ──────────────────────────────────────────────────────────────────

function header(title) {
  console.log("\n" + "═".repeat(60))
  console.log("  " + title)
  console.log("═".repeat(60))
}

function subheader(title) {
  console.log("\n  ── " + title + " ──")
}

// ─── 1. All tables ────────────────────────────────────────────────────────────

header("TABLES")

const tables = await sql`
  SELECT table_schema, table_name, table_type
  FROM information_schema.tables
  WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  ORDER BY table_schema, table_name
`

if (tables.length === 0) {
  console.log("  (no tables found)")
} else {
  for (const t of tables) {
    console.log(`  [${t.table_schema}] ${t.table_name}  (${t.table_type})`)
  }
}

// ─── 2. Columns per table ─────────────────────────────────────────────────────

header("COLUMNS")

for (const t of tables) {
  if (t.table_type !== "BASE TABLE") continue

  subheader(`${t.table_schema}.${t.table_name}`)

  const cols = await sql`
    SELECT
      column_name,
      data_type,
      udt_name,
      character_maximum_length,
      is_nullable,
      column_default
    FROM information_schema.columns
    WHERE table_schema = ${t.table_schema}
      AND table_name   = ${t.table_name}
    ORDER BY ordinal_position
  `

  for (const c of cols) {
    const type =
      c.data_type === "character varying"
        ? `varchar(${c.character_maximum_length ?? "∞"})`
        : c.data_type === "USER-DEFINED"
        ? c.udt_name
        : c.data_type

    const nullable = c.is_nullable === "YES" ? "NULL" : "NOT NULL"
    const def = c.column_default ? `  DEFAULT: ${c.column_default}` : ""

    console.log(`    ${c.column_name.padEnd(32)} ${type.padEnd(24)} ${nullable}${def}`)
  }
}

// ─── 3. Primary keys ──────────────────────────────────────────────────────────

header("PRIMARY KEYS")

const pks = await sql`
  SELECT
    tc.table_schema,
    tc.table_name,
    kcu.column_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema    = kcu.table_schema
  WHERE tc.constraint_type = 'PRIMARY KEY'
    AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')
  ORDER BY tc.table_schema, tc.table_name, kcu.ordinal_position
`

for (const pk of pks) {
  console.log(`  [${pk.table_schema}] ${pk.table_name} → ${pk.column_name}`)
}

// ─── 4. Foreign keys ──────────────────────────────────────────────────────────

header("FOREIGN KEYS")

const fks = await sql`
  SELECT
    tc.table_schema,
    tc.table_name,
    kcu.column_name,
    ccu.table_schema AS foreign_table_schema,
    ccu.table_name   AS foreign_table_name,
    ccu.column_name  AS foreign_column_name,
    rc.delete_rule,
    rc.update_rule
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema    = kcu.table_schema
  JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = tc.constraint_name
   AND ccu.table_schema    = tc.table_schema
  JOIN information_schema.referential_constraints rc
    ON rc.constraint_name = tc.constraint_name
   AND rc.constraint_schema = tc.table_schema
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')
  ORDER BY tc.table_schema, tc.table_name
`

if (fks.length === 0) {
  console.log("  (no foreign keys found)")
} else {
  for (const fk of fks) {
    console.log(
      `  [${fk.table_schema}] ${fk.table_name}.${fk.column_name}` +
        ` → ${fk.foreign_table_schema}.${fk.foreign_table_name}.${fk.foreign_column_name}` +
        `  (ON DELETE ${fk.delete_rule})`
    )
  }
}

// ─── 5. Indexes ───────────────────────────────────────────────────────────────

header("INDEXES")

const indexes = await sql`
  SELECT
    schemaname,
    tablename,
    indexname,
    indexdef
  FROM pg_indexes
  WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
  ORDER BY schemaname, tablename, indexname
`

if (indexes.length === 0) {
  console.log("  (no indexes found)")
} else {
  for (const idx of indexes) {
    console.log(`  [${idx.schemaname}] ${idx.tablename}  →  ${idx.indexname}`)
    console.log(`      ${idx.indexdef}`)
  }
}

// ─── 6. Enums ─────────────────────────────────────────────────────────────────

header("ENUMS / CUSTOM TYPES")

const enums = await sql`
  SELECT
    n.nspname AS schema,
    t.typname AS type_name,
    e.enumlabel AS label
  FROM pg_type t
  JOIN pg_enum e ON t.oid = e.enumtypid
  JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
  ORDER BY schema, type_name, e.enumsortorder
`

if (enums.length === 0) {
  console.log("  (no custom enums)")
} else {
  let last = ""
  for (const e of enums) {
    const key = `${e.schema}.${e.type_name}`
    if (key !== last) { console.log(`  ${key}`); last = key }
    console.log(`    - ${e.label}`)
  }
}

console.log("\n" + "═".repeat(60))
console.log("  Done.")
console.log("═".repeat(60) + "\n")
