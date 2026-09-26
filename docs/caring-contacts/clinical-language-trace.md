# Caring Contact clinical-language trace

This trace freezes the programme boundary used by the linked prototype. It is a product-language control, not a clinical protocol or production authorisation.

| Concern                  | Required expression                                                                                      | Implemented surface/source                                           |
| ------------------------ | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Service model            | Caring contacts are scheduled one-way SMS messages that supplement usual care.                           | One-way boundary cards, Review, Guidance, Plan detail                |
| Reply handling           | Replies are not received, stored, analysed or monitored.                                                 | Central message notice, exact preview, Review, Guidance, Plan detail |
| Agreement                | Use “Agreement confirmed: Yes”; state that this is not legal or treatment consent.                       | Agreement assurances and source note                                 |
| Imported identity/mobile | Describe provenance and patient-controlled suitability; never call imported mobile information verified. | Agreement, patient continuity strip                                  |
| Delivery                 | Delivered means transport receipt only and does not mean read, helped or safe.                           | Patient chronology, Plan, Schedule exception, delivery detail        |
| Delivery exception       | Does not indicate safety, wellbeing, response or engagement and creates no automatic clinical action.    | Contact/delivery exception and guidance                              |
| Emergency boundary       | This programme is not an emergency pathway; staffed programme and crisis roles are distinct.             | Exact message, guidance and fixture contact roles                    |
| Interpretation           | No severity, urgency, sentiment, engagement, wellness or safety inference.                               | Reports, Guidance and exception copy                                 |
| Cadence                  | Day 1, Week 1, Months 1, 2, 3, 4, 6, 8, 10 and 12.                                                       | Central fixtures, pathway, review schedule, overview, plan timeline  |
| Preference               | One patient-selected Morning preference at 10:00 am AWST applies to all ten contacts.                    | Central fixture, Personalisation, schedules                          |
| Exact message            | Central approved text; GSM-7 272 septets, two segments.                                                  | `personalisation-screen.tsx`, preview and review surfaces            |
| Contact roles            | Programme line, patient mobile, operational line and crisis support use four distinct synthetic values.  | Central fixtures and message composition                             |
| Prototype action         | No real plan, SMS, audit record or external request is created.                                          | Activation dialog/outcome, global prototype label                    |

## Exact-message ownership

`EXACT_PATIENT_VISIBLE_MESSAGE`, `PATIENT_VISIBLE_NO_REPLY_NOTICE` and the deterministic GSM-7 calculation live in `src/components/caring-contacts/mockups/personalisation-screen.tsx`. Other surfaces import those values instead of maintaining variants.

The patient-visible message uses neutral support language, identifies a non-receiving sender, explains that replies are not monitored and separates the staffed programme line from crisis support. It does not claim observation, response, wellbeing, risk reduction or therapeutic benefit.

## Operational-state vocabulary

Allowed delivery states are operational: Scheduled, Sending, Delivered, Not delivered, Suppressed, Paused, Cancelled and transport status unavailable. “Delivered” is always accompanied by a transport-only qualification where clinical ambiguity could arise.

Reports aggregate dispatch, permanent transport failure, resolution time and suppression only. They do not rank people or teams by clinical performance and do not infer patient state.
