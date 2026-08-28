/**
 * Idempotency lives here.
 *
 * Saying the same thing twice must not store it twice, and that has to hold
 * across sessions, across restarts, and across trivial differences in how the
 * extractor phrases the same fact. The fingerprint is what the uniqueness
 * constraint in the database is built on, so it has to be stable and boring.
 *
 * Deliberately NOT clever: no stemming, no stopword removal, no synonyms.
 * Aggressive normalisation collapses facts that are genuinely different
 * ("works in Manila" and "does not work in Manila" differ by one stopword),
 * and a false duplicate is a fact silently thrown away.
 */

export function normaliseStatement(statement: string): string {
  return statement
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Scoped by attribute as well as text, so "Manila" filed under `location` and
 * "Manila" filed under `goal` stay separate rows rather than colliding.
 */
export function fingerprint(attribute: string, statement: string): string {
  return `${attribute}|${normaliseStatement(statement)}`;
}
