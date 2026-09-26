// src/lib/caring-contacts/pathway-wording.ts
//
// Which of a plan's scheduled message types its pathway version holds NO wording for.
//
// The sender never invents text: a contact whose message type has no wording is skipped and marked
// for review (./sender.ts). This is the same fact asked earlier, at activation, so a plan that
// would reach a real phone can be refused before it starts rather than failing its first and last
// messages one by one. Blank and absent mean the same thing, as in the templates screens.
import type { MessageType } from "./model";
import type { PathwayVersionSnapshot } from "./pathway-versions";
import type { StoredContact } from "./repository";

export const PATHWAY_WORDING_MISSING_REFUSAL = "pathway-wording-missing";

export function unwrittenScheduledMessageTypes(
  snapshot: PathwayVersionSnapshot,
  contacts: readonly StoredContact[],
): MessageType[] {
  const missing = new Set<MessageType>();
  for (const stored of contacts) {
    if (stored.contact.state !== "scheduled") continue;
    const wording: unknown = snapshot.messageTextByType[stored.planned.messageType];
    if (typeof wording !== "string" || wording.trim() === "") missing.add(stored.planned.messageType);
  }
  return [...missing];
}
