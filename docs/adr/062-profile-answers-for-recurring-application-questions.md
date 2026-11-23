# ADR-062: Profile answers for recurring application questions

Status: Accepted by the owner's direction 2026-11-19; slices 1 to 3 built locally, not released
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

## Implementation notes

1. **Languages live on the Personal record (slice 1, 2026-11-19).** Decision 2 named a new profile
   section. A list on the Personal record (`languages`: language and proficiency, at most 20, each
   language once) is simpler. The export, deletion and import paths already carry that record whole,
   so no new section, route or restore relation is needed. Migration `0015` widens the Personal record's
   key check to allow `pronouns` and `languages`. Each language becomes a `skill` grounding fact
   (`French (fluent)`), which reaches Jev and generated text and never a packet field.
2. **Website falls back to the portfolio.** A "Website" question used to take the portfolio link. It now
   takes `links.website`, which is the "other" link when one is saved and otherwise the portfolio, so no
   form loses an answer it had. A label naming both a website and a portfolio stays the portfolio's.
3. **Years of experience is a number.** The fact is an integer, the field's value type is `integer`, and
   the planner fills only total-years questions. Years with a named tool or field go to Jev, which reads
   the fact.
4. **Preferences feed the packet directly.** Relocation, notice period and earliest start date are read
   from the saved Job preferences next to the work modes, as ADR-060's answers are, with
   `explicit_each_time` review. The old `preference` fact rows stay unused, because no preference facts
   exist.
5. **The restricted keys need no database change (slice 2, 2026-11-19).** The Applications packet
   protects every field whose taxonomy entry is `restricted` and gives it the `restricted_answer`
   reason. Migration 0009's check already refuses a plain value on any field with that reason, so the
   new keys are covered without extending its key list.
6. **Age is restricted, not confidential.** Decision 3 called the 18-or-older answer confidential. It is
   stored with the other restricted statements: its export list is the taxonomy's restricted,
   never-infer set, and the restricted path is stricter.
7. **Work authorization by country.** A question the planner maps to `authorization.us_authorized`
   (including "authorized to work in the country where this job is located") reads
   `authorization.work_countries` first and falls back to the United States answer. Jev's restricted
   context then holds that statement, the job title and company, and the job's posted locations, so it
   can tell whether the job's country is in the list. The planner has no separate pattern for the
   countries key, so that wording never becomes ambiguous.
8. **Option lists live in the web form.** The self-identification and clearance options are the form's
   fixed choices; the saved value is the chosen text. Jev matches a saved statement to the employer's
   own option wording, so the taxonomy does not pin `allowedValues`.
9. **The Sensitive answers tab follows the vault switch.** It appears when the web build has
   `NEXT_PUBLIC_RESTRICTED_ANSWER_VAULT_UI=enabled`, the same switch the vault's web routes already
   require.
10. **The required-before-Apply check (slice 3, 2026-11-19)** lives in the web app's existing basics
    check. It asks for:
    - the country of residence and at least one work-history entry;
    - Job preferences with a relocation answer and either an earliest start date or a notice period;
    - with the Sensitive answers tab on, the work-authorization countries, and sponsorship (as a
      screening or a sensitive answer).
    Each missing item links to its profile tab. A profile it cannot read still counts as incomplete,
    as before.

## Amendment 2026-11-23: no Sensitive answers tab; every question is a choice

Owner direction: remove the Sensitive answers tab. Typing a question key, a context and a free-text
answer is too much work. The questions it held move to tabs where each one is answered by choosing,
in line with ADR-010's 2026-11-05 amendment (answers the candidate sets are ordinary answers).

- **One shared list.** `@ai-job-apply/ats-sdk/profile-questions` lists each question: its field key,
  exact saved question text, kind (Yes/No, a fixed list, or countries) and tab. The web app and the
  Gateway both read it. The two United States questions keep their existing wording. The new ones end
  in "(ApplyDash profile)", like the salary question, so no employer form matches them by accident.
- **Screening tab:** authorized in the United States, sponsorship, countries where the candidate can
  work without sponsorship (a country multi-select), countries of citizenship, 18 or older, and
  security clearance.
- **Equal employment tab (new):** gender, race or ethnicity, Hispanic or Latino, veteran, disability,
  sexual orientation and transgender. Every one is optional, offers "I prefer not to say", and can be
  set back to "Not answered", which removes the saved answer.
- **Dropped:** export control, non-compete and conflict of interest. These are specific to one job,
  so the candidate answers them on that job's form.
- **Storage:** ordinary saved answers in the Profile, like the screening and salary answers. The
  Answers tab does not list them, because their own tabs own them. The vault's tables, routes, export
  and deletion are unchanged, and nothing new is written to the vault. Removing them is still the
  separate, data-affecting decision ADR-010 names.
- **Required before Apply:** authorized in the United States, sponsorship, and the work countries.
  This is now always checked. The `NEXT_PUBLIC_SCREENING_ANSWERS_REQUIRED` rollout switch is gone,
  because the Profile service has accepted these answers since 2026-11-05.
- **Jev (supersedes note 7's source):** a restricted question's statement is the candidate's chosen
  answer to the matching Profile question. The work countries still come first for work
  authorization. A saved answer on a restricted topic never joins the standard request's saved
  answers. The Gateway no longer reads the vault for Jev.

Notes 8 and 9 are superseded: the option lists live in the shared list, and the tab is gone.
