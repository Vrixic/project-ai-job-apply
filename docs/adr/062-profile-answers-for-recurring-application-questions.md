# ADR-062: Profile answers for recurring application questions

Status: Accepted by the owner's direction 2026-11-19; not built
Date: 2026-11-19

## Context

On 2026-11-19 we collected the application questions of 3,645 public job application forms from 194
companies (Greenhouse and Ashby job board APIs, read only): 57,970 questions in 4,011 wordings, which
merge into 81 distinct questions asked by at least two companies (the "Application Question Index").
The fill, the AI answer icon ([ADR-057](057-narrative-answers-drafted-in-the-candidates-browser.md)) and
Jev ([ADR-061](061-choice-answers-decided-by-jev.md)) can only answer what the candidate's profile holds.
The owner asked which of those questions should be answered once in the profile, required where
needed, so these engines answer them with confidence.

Reading the code showed gaps behind questions most forms ask:

- The address stores a country, but no grounding fact or packet field reads it.
- The "other" link kind is stored but never reaches a packet.
- Relocation, notice period and earliest start date have packet rows but no source, so they never fill.
- Work authorization exists only as one US boolean (a saved screening answer and a vault key).
- The restricted answer vault has routes and a web form, but the form is not mounted on any page.
- Hispanic/Latino, sexual orientation and transgender exist only as classifier terms.

## Decisions

1. **Facts about the person go in the profile; answers about one employer or one job do not.**
   Questions that depend on the employer or the role are answered per application by the candidate or,
   with their review, by AI. Examples: why this company or role, which office, previously applied here,
   referral details, used the product. Consents and acknowledgements are a legal act by the candidate
   each time and are never stored, prefilled or decided by AI. Examples: privacy notice, AI-use policy,
   interview recording, SMS, arbitration, "certify accurate".
2. **New or newly usable profile data.** The owner excluded people-management years.

   | Data | Where it is kept | Sensitivity | Packet field |
   |---|---|---|---|
   | Country of residence | Personal address `country` (exists) | confidential | `contact.address.country` |
   | Personal website / other link | Personal links kind `other` (exists) | standard | `links.website` |
   | X / Twitter profile | Personal links, new kind `x` | standard | `links.x` |
   | Pronouns | Personal, new optional `pronouns` | confidential | `identity.pronouns` |
   | Spoken languages and fluency | New profile section `language` (language, proficiency) | standard | none: grounding facts for Jev |
   | Years of professional experience | Derived from work history | standard | `employment.years_experience` |
   | Open to relocation | Job preferences `relocation` | standard | `job.relocation` (existing row) |
   | Notice period | Job preferences `noticePeriod` | standard | `job.notice_period` (existing row) |
   | Earliest start date | Job preferences `availableStartDate` | standard | `job.available_start_date` (existing row) |

   The years of experience count the union of the work-history date ranges, rounded down to whole
   years, and update when the candidate edits their history. The candidate corrects the count by
   correcting the history, not by typing a number.
3. **New restricted saved statements in the vault.** Each is the candidate's own saved answer, never
   inferred, encrypted like the existing vault entries:
   - `authorization.work_countries`: the countries where the candidate may work without sponsorship,
     as ISO country codes. It answers "authorized to work in the country of this job" for any country.
     The existing `authorization.us_authorized` stays for compatibility.
   - `authorization.citizenship`: the countries of citizenship. It is used only when a form asks
     (export control).
   - `disclosure.security_clearance`: optional.
   - `eligibility.age_18_or_over`: a Yes/No answer, confidential.
   - Voluntary self-identification: `demographic.hispanic_latino`,
     `demographic.sexual_orientation` and `demographic.transgender`.

   The four existing demographic keys get fixed option lists in place of free text. Every demographic
   list includes "I prefer not to say".
4. **A "Sensitive answers" profile tab** mounts the existing vault form with these keys. A restricted
   answer is still proposed and confirmed per question (ADR-061 decision 3), and the packet still marks
   it for review.
5. **Required before Apply.** The existing basics check (name, email, phone, education, salary) also
   requires the following before an application is prepared:
   - country of residence
   - work-authorization countries
   - sponsorship
   - at least one work mode
   - relocation
   - an earliest start date or a notice period
   - at least one work-history entry, so the years of experience exist

   Demographics, pronouns, citizenship, clearance and age stay optional. Self-identification is
   voluntary by law and is never required, inferred or defaulted.
6. **How the engines use it.**
   - **Packet:** the new fields fill through the existing fact rows and vault selection under the field
     policy. Restricted keys are `never_infer`, and the work-preference fields are
     `explicit_each_time`, as in ADR-060.
   - **Fill planner:** new label patterns for country, website, X, pronouns, years of experience and the
     new self-identification questions.
   - **Jev:** the standard context gains languages, years of experience, country and relocation. A
     restricted question reads only its own key's statement; for country-specific authorization that is
     `authorization.work_countries`, with the job's country.

## Consequences

- One additive Profile migration: personal keys, a section, and preference fields. The OpenAPI changes
  are additive optional fields, plus a new link kind and a new section. The taxonomy gains about 12
  fields, kept in sync with its bundled copy.
- Existing profiles stay valid. Until the new required items are filled, Apply shows what is missing
  and links to the tab, as it does for the current basics.
- The export and deletion paths include the new vault keys (the export key list is tested against the
  taxonomy).
- The question index data lives outside the repository for now. It is research input, not a runtime
  dependency.
