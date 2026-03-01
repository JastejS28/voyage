from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv
import psycopg2

load_dotenv()  # read .env file in project root
DATABASE_URL = os.environ.get("DATABASE_URL")


@dataclass
class ColumnInfo:
    name: str
    data_type: str
    is_nullable: str


def print_schema(url: str) -> None:
    """Connect to the database at *url* and dump the table/column schema to stdout."""
    print(f"DEBUG: raw DATABASE_URL -> {repr(url)}")
    if url is None:
        raise ValueError("DATABASE_URL not set in environment")

    # psycopg2 expects either a space-separated dsn or kwargs; the
    # incoming string should be a standard postgres URL.  it will treat a
    # string like "DATABASE_URL=..." as a parameter list, hence the
    # ProgrammingError seen earlier.  if the value erroneously contains
    # the literal prefix, strip it.
    if url.startswith("DATABASE_URL="):
        url = url.split("=", 1)[1]

    # connect using psycopg2; it accepts the URL directly
    with psycopg2.connect(url) as conn:
        with conn.cursor() as cur:
            # fetch all user tables
            cur.execute(
                """
                SELECT table_schema, table_name
                FROM information_schema.tables
                WHERE table_type = 'BASE TABLE'
                  AND table_schema NOT IN ('information_schema', 'pg_catalog')
                ORDER BY table_schema, table_name
                """
            )
            tables = cur.fetchall()

            for schema, tbl in tables:
                print(f"\nSchema: {schema}, Table: {tbl}")
                cur.execute(
                    """
                    SELECT column_name, data_type, is_nullable
                    FROM information_schema.columns
                    WHERE table_schema = %s AND table_name = %s
                    ORDER BY ordinal_position
                    """,
                    (schema, tbl),
                )
                cols = [ColumnInfo(*row) for row in cur.fetchall()]
                for col in cols:
                    print(f"    {col.name} {col.data_type} nullable={col.is_nullable}")


def main() -> None:
    print("connecting to database and printing schema...")
    print_schema(DATABASE_URL)


if __name__ == "__main__":
    main()
