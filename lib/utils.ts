// Backend sentinel values — treated the same as null (not worth showing)
const SENTINEL_VALUES = new Set(["unknown", "none", "n/a", "", "any"])

/**
 * Recursively removes null, undefined, empty arrays, empty objects,
 * and backend sentinel strings ("unknown", "none", etc.)
 * from a nested object — used before rendering structured_requirement.
 */
export function cleanObject(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    const cleaned = obj
      .map(cleanObject)
      .filter((v) => v !== null && v !== undefined)
    return cleaned.length > 0 ? cleaned : undefined
  }

  if (typeof obj === "object" && obj !== null) {
    const entries = Object.entries(obj as Record<string, unknown>)
      .map(([k, v]) => [k, cleanObject(v)] as [string, unknown])
      .filter(([, v]) => v !== null && v !== undefined)

    return entries.length > 0 ? Object.fromEntries(entries) : undefined
  }

  // Strip sentinel strings and empty strings
  if (typeof obj === "string" && SENTINEL_VALUES.has(obj.toLowerCase().trim())) {
    return undefined
  }

  // Strip false — it is almost always a default, not informative
  if (obj === false) return undefined

  return obj
}

/**
 * Simple class name merger.
 */
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(" ")
}

/**
 * Capitalises the first letter and replaces underscores with spaces.
 */
export function formatKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Returns true if a value is a plain object (not array, not null).
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
