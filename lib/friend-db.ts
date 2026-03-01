/**
 * Neon serverless client for the friend's database.
 * Used server-side only (API routes).
 */
import { neon } from "@neondatabase/serverless"

const FRIEND_DB_URL = process.env.FRIEND_DATABASE_URL!

if (!FRIEND_DB_URL) {
  throw new Error("FRIEND_DATABASE_URL is not set in environment variables")
}

export const friendDb = neon(FRIEND_DB_URL)
