import { CheckCircle2, CircleHelp, Info, MessageSquareText, ShieldCheck } from "lucide-react";

import { AWST_TIME_ZONE } from "@/lib/caring-contacts/clock";
import { PATIENT_VISIBLE_NO_REPLY_NOTICE } from "@/lib/caring-contacts/message-copy";
import { CARING_CONTACT_ROLE_WORDING } from "@/lib/caring-contacts/permissions";
import { workspacePanelFlush } from "./surfaces";

/**
 * Programme boundaries and operational guidance -- the approved Guidance design, built.
 *
 * A SERVER COMPONENT, deliberately. Every word on this screen is fixed text and there is no state
 * to hold, so it adds no client payload at all. The property Ruling 13 protects is the module
 * boundary, not a file count; a screen that ships no client component simply does not enter it.
 *
 * WHERE THE WORDS COME FROM, because "the approved design says so" is not a source for a sentence a
 * clinician acts on:
 *
 *   * the no-reply notice is `PATIENT_VISIBLE_NO_REPLY_NOTICE`, rendered from the domain constant
 *     and never retyped. It is the wording the PATIENT is sent, quoted here so a clinician can see
 *     what the patient was told, and patient-visible copy is frozen -- a screen that hardcoded the
 *     string would be a defect even while the string still matched;
 *   * the role is `CARING_CONTACT_ROLE_WORDING`, resolved from the sealed domain, never a raw
 *     identifier and never a job title typed into a component;
 *   * the time zone is `AWST_TIME_ZONE`, the same constant every instant in this domain is
 *     formatted through.
 *
 * TWO DEPARTURES FROM THE APPROVED DESIGN, both recorded in the Task 19 report rather than made
 * silently:
 *
 *   * the design's boundary panel ends "…never means the message was read or the patient is
 *     safe". That sentence cannot be written in this tree: the interface-vocabulary scan refuses
 *     `safe` as a whole word, and the standing constraints forbid exploiting the scan's known word-
 *     boundary inversion to slip a banned word past it. The replacement says the same thing without
 *     the word -- what `Delivered` is, and the three things it is not;
 *   * the design's language-rules table has a row reading "Use / Agreement", which is legible in a
 *     design board beside its neighbours and not on its own. It is written out here as the
 *     instruction it abbreviates.
 *
 * NOTHING ON THIS SCREEN IS DRAFTED PATIENT-VISIBLE COPY. The one patient-visible string it shows
 * is quoted from the domain and labelled as what the patient is told.
 */

const INCIDENT_GUIDANCE: readonly string[] = [
  "Pause sending when a system incident is declared.",
  "Do not queue messages beyond the next approved send.",
  "Record the incident and notify the owning team.",
  "Resume the original schedule only after restoration is confirmed.",
  "Do not automatically resend a contact missed during downtime.",
];

const LANGUAGE_RULES: readonly { readonly term: string; readonly rule: string }[] = [
  { term: "Say", rule: "Agreement — never consent." },
  { term: "Never imply", rule: "Consent, monitoring, or a crisis response." },
  { term: "Delivered means", rule: "A transport receipt, and nothing about the person." },
  { term: "Times", rule: `Always AWST — the ${AWST_TIME_ZONE} clock every instant here is written in.` },
  { term: "Actions", rule: "Verb first, and name the object acted on." },
];

const sectionClass = workspacePanelFlush;

export function ProgrammeGuidance() {
  // Two columns of prose only at 1440px. At `lg:` this gave ~296px of text per column after the
  // cards' own padding — roughly forty characters, well under a comfortable measure — and the
  // paragraphs are already capped at `var(--measure)`, so a single column costs nothing below that
  // width. `min-[1440px]:` rather than a named breakpoint, per design-system GATES §3b.
  return (
    <div className="grid min-w-0 gap-5 min-[1440px]:grid-cols-2" data-testid="caring-contacts-guidance">
      <div className="min-w-0 space-y-5">
        <section
          aria-labelledby="caring-contacts-guidance-boundary"
          className="rounded-[var(--radius-lg)] border border-[color:var(--info-border)] bg-[color:var(--info-soft)] p-4 sm:p-5"
        >
          <div className="flex items-start gap-3">
            <Info
              aria-hidden="true"
              className="mt-0.5 size-icon-md shrink-0 text-[color:var(--info-text)] forced-colors:text-[CanvasText]"
            />
            <div className="min-w-0">
              <h2
                id="caring-contacts-guidance-boundary"
                className="text-sm font-semibold text-[color:var(--text-heading)]"
              >
                One-way programme boundary
              </h2>
              <p className="mt-1 text-sm leading-6 text-[color:var(--text-muted)]">
                Caring contacts supplement usual care. Every patient is told, in the message itself:{" "}
                <q className="font-medium text-[color:var(--text)]">{PATIENT_VISIBLE_NO_REPLY_NOTICE}</q>. Delivered is
                a transport receipt from the carrier. It does not mean the message was read, it does not mean the
                patient is well, and it is never a statement about how someone is.
              </p>
            </div>
          </div>
        </section>

        <section aria-labelledby="caring-contacts-guidance-incident" className={sectionClass}>
          <div className="border-b border-[color:var(--border)] px-5 py-4 sm:px-6">
            <h2
              id="caring-contacts-guidance-incident"
              className="flex items-center gap-2 text-sm font-semibold text-[color:var(--text-heading)]"
            >
              <ShieldCheck aria-hidden="true" className="size-icon-md shrink-0" />
              Incident and downtime
            </h2>
            <p className="mt-1 text-xs leading-5 text-[color:var(--text-muted)]">
              How this programme behaves when a system it depends on is unavailable. It degrades conservatively rather
              than guessing.
            </p>
          </div>
          <ul className="space-y-3 px-5 py-5 text-sm leading-6 text-[color:var(--text-muted)] sm:px-6">
            {INCIDENT_GUIDANCE.map((item) => (
              <li key={item} className="flex items-start gap-3">
                <CheckCircle2
                  aria-hidden="true"
                  className="mt-1 size-icon-sm shrink-0 text-[color:var(--clinical-accent)] forced-colors:text-[CanvasText]"
                />
                <span className="min-w-0">{item}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="min-w-0 space-y-5">
        <section aria-labelledby="caring-contacts-guidance-language" className={sectionClass}>
          <div className="border-b border-[color:var(--border)] px-5 py-4 sm:px-6">
            <h2
              id="caring-contacts-guidance-language"
              className="flex items-center gap-2 text-sm font-semibold text-[color:var(--text-heading)]"
            >
              <MessageSquareText aria-hidden="true" className="size-icon-md shrink-0" />
              Language rules
            </h2>
          </div>
          <dl className="divide-y divide-[color:var(--border)] px-5 text-sm sm:px-6">
            {LANGUAGE_RULES.map(({ term, rule }) => (
              <div key={term} className="py-3">
                <dt className="text-xs font-medium text-[color:var(--text-muted)]">{term}</dt>
                <dd className="mt-1 font-medium text-[color:var(--text)]">{rule}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="caring-contacts-guidance-help" className={sectionClass}>
          <div className="border-b border-[color:var(--border)] px-5 py-4 sm:px-6">
            <h2
              id="caring-contacts-guidance-help"
              className="flex items-center gap-2 text-sm font-semibold text-[color:var(--text-heading)]"
            >
              <CircleHelp aria-hidden="true" className="size-icon-md shrink-0" />
              Need help?
            </h2>
          </div>
          <p className="px-5 py-4 text-sm leading-6 text-[color:var(--text-muted)] sm:px-6">
            Take any uncertainty about the programme, its wording, or how it is being run to the{" "}
            {CARING_CONTACT_ROLE_WORDING.teamLead}. Never infer how a patient is from transport data.
          </p>
        </section>
      </div>
    </div>
  );
}
