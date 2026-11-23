/**
 * Action intent is an open enum: a newer producer may send a value this
 * renderer does not know. An unknown intent is treated as destructive (the
 * safest reading), never as the neutral default, so a dangerous action is not
 * rendered as an ordinary one.
 */
const KNOWN_ACTION_INTENTS: ReadonlySet<string> = new Set([
  "primary",
  "secondary",
  "danger",
  "success",
  "warning",
  "info",
  "link",
  "ghost",
]);

/** True for `danger` and for any non-empty intent this renderer does not know. */
export function isDangerIntent(intent: string | undefined | null): boolean {
  if (!intent) return false;
  return intent === "danger" || !KNOWN_ACTION_INTENTS.has(intent);
}
