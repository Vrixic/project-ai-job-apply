# ADR-060: Work-location answers from the Job preferences page

Status: Accepted by the owner's direction 2026-11-18; built and verified locally, not released
Date: 2026-11-18

## Context

On the live Mintlify (Ashby) form, "This is an in-person role. Are you willing to work in our San
Francisco or NYC office?" was left to the candidate: no packet key matched it. The candidate already
states how they will work on the Job preferences page (work modes Remote, Hybrid and On-site, and up to
ten locations), but that store feeds search and matching only. An application packet is built from
confirmed Profile facts, selected saved answers and the candidate's own entries, so the preferences
never reached an employer form. The AI answer icon writes free text only and never chooses an option
([ADR-057](057-narrative-answers-drafted-in-the-candidates-browser.md)).

## Decisions

1. **Three derived Yes/No fields.** `job.remote_willingness`, `job.hybrid_willingness` and
   `job.onsite_willingness` (boolean, standard sensitivity). The Applications packet builder derives them
   from the saved work modes only: remote is true when Remote is saved; hybrid when Hybrid or On-site is
   saved (accepting the office full time accepts some office days); on-site when On-site is saved.
2. **Shown for confirmation, never silent.** The field policy is `explicit_each_time`, so each answer
   appears in the packet review with the reason `explicit_each_time` and is acknowledged by the candidate
   like any other reviewed field. It cites the saved preference record as its source. A candidate entry
   or selected saved answer for the same field wins. The packet is immutable, so later preference edits
   apply to the next packet.
3. **Locations and relocation are not read.** A location list does not say where the candidate lives or
   whether they would move, so relocation (`job.relocation`) and any city-specific question stay with the
   candidate or their saved answer. The question's city (San Francisco, NYC) is not compared with the
   saved locations; the candidate sees the answer and decides.
4. **Choice fields only.** The planner recognises on-site, in-person, office, hybrid and remote
   wording on radio, select and checkbox fields. A free-text box is never filled with Yes or No. A label
   that names two of these (for example "in-person" and "remote") is ambiguous and stays with the
   candidate. `job.remote_preference` (an enum with no producer) no longer matches any label.
5. **No AI and no new data flow.** Nothing is sent to a model or any new service. The values reach an
   employer only through the existing approved packet and fill, after the candidate's confirmation. A
   failed preferences read only leaves these questions to the candidate.
6. **No persistence change.** The taxonomy gains three entries (both copies); the Gateway passes the
   Profile's saved preferences to the Applications runtime. No migration and no API change.

## Consequences

A candidate who saved only Remote will have the in-person question answered No in the review, which is
true to their own preferences; they change the saved modes or the answer. A saved Remote-only
preference never answers an on-site question Yes. The Gateway and Applications code needs a release to
take effect; the extension needs nothing new beyond the shared planner patterns.

## Verification

Real Chrome against the live Mintlify page with employer writes blocked: Remote only presses No, Hybrid
and On-site press Yes, and the page run accepts both. The packet derivation and its review policy have
unit tests.
