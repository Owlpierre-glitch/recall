/**
 * Cardinality is the whole conflict story.
 *
 * "I live in Manila" then later "I moved to Cebu" must not leave two live
 * answers to one question. "I like coffee" then later "I like tea" must not
 * throw coffee away. The difference is not something the model should decide
 * turn by turn, because that makes the behaviour unrepeatable and untestable.
 * So the code owns it: a fixed registry of dimensions that can only hold one
 * value at a time, and everything else appends.
 *
 * Unknown attributes default to appending, deliberately. Appending a fact that
 * should have replaced one is a visible, correctable mess in the memory panel.
 * Replacing a fact that should have been appended silently destroys something
 * the person told us. The safe direction is to keep both.
 */

/** Dimensions where a new value replaces the old one. */
export const SINGLE_VALUED: ReadonlySet<string> = new Set([
  "name",
  "location",
  "timezone",
  "employer",
  "job_title",
  "pronouns",
  "birthday",
  "age",
  "relationship_status",
  "current_project",
  "contact_email",
  "occupation",
]);

/** Dimensions that accumulate. Listed so the extractor has a vocabulary to aim at. */
export const MULTI_VALUED: ReadonlySet<string> = new Set([
  "likes",
  "dislikes",
  "skill",
  "goal",
  "constraint",
  "pet",
  "tool",
  "habit",
  "experience",
  "preference",
]);

export const KNOWN_ATTRIBUTES: readonly string[] = [
  ...SINGLE_VALUED,
  ...MULTI_VALUED,
].sort();

/**
 * Models return "Location", "current-project", " Job Title " and worse. Fold all
 * of that onto one slug before it is ever compared or stored.
 */
export function normaliseAttribute(raw: string): string {
  const slug = raw
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (slug === "") return "other";
  // A few aliases the model reaches for often enough to be worth pinning.
  const aliases: Record<string, string> = {
    city: "location",
    country: "location",
    lives_in: "location",
    home: "location",
    company: "employer",
    work: "employer",
    workplace: "employer",
    role: "job_title",
    title: "job_title",
    profession: "occupation",
    job: "occupation",
    likes_food: "likes",
    like: "likes",
    dislike: "dislikes",
    hobby: "likes",
    skills: "skill",
    goals: "goal",
    tools: "tool",
    pets: "pet",
    full_name: "name",
    email: "contact_email",
  };
  return aliases[slug] ?? slug;
}

export function isSingleValued(attribute: string): boolean {
  return SINGLE_VALUED.has(normaliseAttribute(attribute));
}
