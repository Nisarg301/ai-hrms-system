/** Escapes text so it matches literally inside a regular expression. */
export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A case-insensitive "contains" pattern for a search box. The text is escaped:
 * raw input like "C++(" would otherwise be an invalid pattern (a 500), and a
 * crafted one could make MongoDB's regex engine crawl.
 */
export function containsPattern(text: string): RegExp {
  return new RegExp(escapeRegex(text), 'i');
}
