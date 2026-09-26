/**
 * The full prohibited vocabulary for caring-contacts interface copy, in ONE place.
 *
 * It was defined twice, byte for byte, in `caring-contacts-overlay-definitions.test.ts`
 * and `caring-contacts-overlay-host.dom.test.tsx`. Two copies of a safety list drift:
 * a term added to one would leave the other quietly checking the old set, and the
 * failure mode is a green suite that no longer covers what it claims to.
 *
 * `lead` is not a plain word-boundary match, though word boundaries are still what keep it off
 * `already`. It is four alternatives, in two matched pairs -- one pair for the plural, one for the
 * singular, each behaving the same way. `lead` or `leads` followed by a commercial companion word
 * -- generation, capture, nurturing, a magnet, a pipeline, numbers -- is refused even when a
 * job-title qualifier sits immediately before it, so an exemption cannot license whatever follows
 * the word it exempts. Otherwise `lead` or `leads` is refused as a whole word, exempt only when
 * one of this domain's closed set of job titles sits IMMEDIATELY before it: incident, programme,
 * clinical, service or team. Refusal is the default and the exemption is the narrow case, rather
 * than the other way round, because the commercial vocabulary for `lead` is open-ended and an
 * allowlist of sales phrasing refuses only what somebody thought to list. That allowlist was
 * itself the defect; the fix round 1 note above `COMMERCIAL_LEAD_PATTERN` in
 * `src/lib/caring-contacts/message-rules.ts` records it.
 *
 * THE PLURAL IS WHERE THIS DEFINITION AND THE MESSAGE ONE DELIBERATELY PART. Ruling [143] refused
 * `leads` outright on both surfaces, reasoning that nobody's job title is plural. That is true of
 * one person's title and false of a group of them, and "the clinical leads met on Tuesday" is
 * ordinary English a clinician had no way to write. #AGRAKQ carried the point; the owner decided
 * on 2026-09-02 to extend the job-title exemption to the plural HERE ONLY, so a screen may say
 * "the clinical leads" while a message still may not. The asymmetry is the safe direction and is
 * the whole reason it was taken on only one surface: loosening the wording a discharged patient
 * receives is the highest-consequence change available in this feature, and nothing needed it.
 * Bare commercial plurals are untouched -- "sales leads", "new leads", "warm leads", "qualified
 * leads", "leads capture" and a lone "Leads" are all still refused on both surfaces.
 *
 * WHAT THE PLURAL EXEMPTION LETS THROUGH, measured rather than assumed (review of 33e1ffd,
 * 2026-09-02). It is wider than "plural job titles", and the reason is worth understanding before
 * anyone widens it further. The companion list guards words that come AFTER the word, which is
 * where singular commercial English puts them -- "lead generation", "lead capture". Plural
 * commercial English puts them BEFORE -- "capture leads", "convert leads", "unconverted leads" --
 * and nothing guards that position. So every one of these was refused before the plural exemption
 * and is permitted now:
 *
 *     Capture clinical leads      Convert team leads         Nurture clinical leads
 *     Generate service leads      Qualify incident leads     Score service leads
 *     Unconverted service leads   clinical leads dashboard   team leads funnel
 *     "Our team leads are up 20% this quarter."
 *
 * The singular pair has the same shape of hole -- "Capture the clinical lead" was already permitted
 * on both surfaces before any of this -- so this is a pre-existing structural gap made easier to
 * reach, not a new class of one. It was left open deliberately. Closing it by requiring a
 * determiner ("the clinical leads") would refuse an ordinary screen heading of "Clinical leads" on
 * a team roster, which is the exact wording the owner's decision existed to permit; closing it with
 * a list of commercial verbs would rebuild the allowlist that `message-rules.ts` records as the
 * original defect, because commercial vocabulary is open-ended. Tracked as its own outstanding
 * issue rather than fixed here. If you widen this exemption again, measure this list first.
 *
 * Two smaller consequences of the same shape, also measured. `leads` as a VERB after a qualifier is
 * now permitted -- "the team leads the review", "this programme leads to discharge" -- which is
 * benign but is not a job title; without a qualifier it is still refused ("this leads to a
 * referral"). And the lookbehind wants exactly one literal space, so "clinical-leads",
 * "clinical  leads" and a line break between "clinical" and "leads" are all still refused. That
 * last one is the practical trap: the raw-prose pass reads JSX text, so Prettier wrapping a line at
 * that point produces a confusing refusal of wording that is now explicitly permitted. Rewrap
 * rather than adding an exemption.
 *
 * The rest of the rule is written a second time, for messages, as `COMMERCIAL_LEAD_PATTERN` in
 * `src/lib/caring-contacts/message-rules.ts`. Nothing under `src/lib/caring-contacts/**` may
 * import a test helper, so the duplication is structural rather than accidental and cannot be
 * removed by sharing this constant. What holds the two in step is the Ruling [143] parity block at
 * the bottom of `tests/caring-contacts-interface-vocabulary.test.ts`, whose invariant is
 * one-directional and still holds: nothing the screen refuses may be permitted in a message. A
 * screen that PERMITS what a message refuses is the direction that invariant deliberately allows,
 * which is why the plural decision could be taken here without weakening anything. Anyone editing
 * EITHER definition runs that test.
 *
 * The list is deliberately wider than `PROVISIONAL_MESSAGE_RULES.prohibitedTerms` in
 * `src/lib/caring-contacts/message-rules.ts`, which governs the words that may appear
 * in a MESSAGE to a patient. This governs interface copy, and adds the scoring and
 * reply-monitoring claims that a message could not make but a screen could.
 */
export const CARING_CONTACTS_PROHIBITED_LANGUAGE =
  /\bhigh risk\b|\bsafe\b|\bengagement scores?\b|\bcampaigns?\b|\bleads\s+(?:generation|capture|gen\b|nurturing|magnet|source|score|scoring|pipeline|qualification|conversion|database|numbers)\b|(?<!\b(?:incident|programme|clinical|service|team) )\bleads\b|\blead\s+(?:generation|capture|gen\b|nurturing|magnet|source|score|scoring|pipeline|qualification|conversion|database|numbers)\b|(?<!\b(?:incident|programme|clinical|service|team) )\blead\b|\bconversions?\b|\bbest match\b|\binbox(es)?\b|\bconversations?\b|\bclinical risk\b|\brisk scores?\b|\bwellbeing scores?\b|monitor(s|ed|ing)? (the )?repl(y|ies)|repl(y|ies) (are|is) monitored/i;
