import type { ContactState, MessageType } from "@/lib/caring-contacts/model";

/**
 * The words this workspace uses for a contact's KIND and for its STATE, in one place.
 *
 * WHY IT MOVED HERE. Both maps were declared inside `patient-overview.tsx`, which was the only
 * screen that showed a contact. Phase 2B Task 13's Schedule screen is the second, and the closed
 * transport vocabulary is exactly the kind of wording that must not exist twice: a second copy is
 * free to go on calling a provider outcome something the first has stopped calling it, on two
 * screens a clinician reads in the same session. This module is plain data with no React, so
 * importing it pulls in no component.
 *
 * It is data rather than a function on purpose. Both maps are `Record`s over a closed union, so a
 * state or a message kind added to the domain and left unlabelled here does not compile.
 */

/**
 * What each kind of message in a plan is called.
 *
 * The closing message has its own label because it is its own kind: it ends the plan and is not one
 * more caring contact. Naming it "Caring contact" would overstate the plan by one.
 */
export const MESSAGE_TYPE_LABELS: Readonly<Record<MessageType, string>> = Object.freeze({
  first: "First message",
  standard: "Caring contact",
  closing: "Closing message",
});

/**
 * Plain words for a contact's state.
 *
 * Every provider-reported state is labelled as a transport receipt, because that is the whole of
 * what it is: "Delivered" says the message provider accepted and reported the message, and says
 * nothing whatever about the patient. It is never a patient-state label.
 */
export const CONTACT_STATE_LABELS: Readonly<Record<ContactState, string>> = Object.freeze({
  scheduled: "Scheduled",
  processing: "Being sent",
  sent: "Sent",
  delivered: "Delivered (transport receipt)",
  notDelivered: "Not delivered (transport receipt)",
  numberInvalid: "Number invalid (transport receipt)",
  contactChanged: "Number changed (transport receipt)",
  statusUnavailable: "Transport receipt unavailable",
  missed: "Missed",
  suppressed: "Suppressed",
  cancelled: "Cancelled",
});
