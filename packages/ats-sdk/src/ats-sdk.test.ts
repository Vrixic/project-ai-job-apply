// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { extractGenericForm, interactiveCaptchaPresent } from "./extract.js";
import { formStructureHash } from "./form-model.js";
import { mapFormFields } from "./mapping.js";
import { buildFillPlan, type PacketValue, planAssistedManual } from "./plan.js";
import { ADAPTER_DECLARATIONS, AdapterRegistry, type FixtureEvidence } from "./registry.js";

// Every page below is a synthetic test form written for this suite. It is NOT provider evidence
// and cannot satisfy the D3-013 fixture gate.
function page(html: string): ParentNode {
  const document = new DOMParser().parseFromString(
    `<body><form>${html}</form></body>`,
    "text/html",
  );
  return document.body;
}

const BASIC = `
  <label for="fn">First name *</label><input id="fn" name="first_name" required>
  <label for="ln">Last name *</label><input id="ln" name="last_name" required>
  <label>Email <input type="email" name="email" required></label>
  <label for="li">LinkedIn URL</label><input id="li" name="linkedin">
  <label for="auth">Are you legally authorized to work in the United States?</label>
  <select id="auth" name="auth" required><option>Yes</option><option>No</option></select>
  <fieldset><legend>Do you require sponsorship?</legend>
    <label><input type="radio" name="spons" value="y"> Yes</label>
    <label><input type="radio" name="spons" value="n"> No</label>
  </fieldset>
  <label for="cv">Resume/CV *</label><input id="cv" type="file" name="resume" required>
  <label><input type="checkbox" name="cert" required> I certify the information above is true and correct</label>
  <label for="notes">Anything else?</label><textarea id="notes" name="notes"></textarea>
  <input type="hidden" name="token" value="secret-csrf">
  <input type="password" name="pw">
  <input type="submit" value="Submit application">
`;

describe("generic form extraction", () => {
  const form = extractGenericForm(page(BASIC));

  it("reads labels from for/wrapping/legend, groups radios, and excludes non-fields", () => {
    expect(form.fields.map((field) => [field.label, field.type, field.required])).toEqual([
      ["First name *", "text", true],
      ["Last name *", "text", true],
      ["Email", "text", true],
      ["LinkedIn URL", "text", false],
      ["Are you legally authorized to work in the United States?", "select", true],
      ["Do you require sponsorship?", "radio", false],
      ["Resume/CV *", "file", true],
      ["I certify the information above is true and correct", "checkbox", true],
      ["Anything else?", "textarea", false],
    ]);
    expect(form.fields[4]?.options).toEqual(["Yes", "No"]);
    expect(form.fields[5]?.options).toEqual(["Yes", "No"]);
    expect(form.challengePresent).toBe(false);
  });

  it("labels a legend-less radio group from its fieldset heading label", () => {
    // Synthetic markup shaped like a provider group whose question is a heading label, not a legend.
    const grouped = extractGenericForm(
      page(`<fieldset><label for="q-1">Will you now or in the future require visa sponsorship?</label>
        <div><input type="radio" id="o1_q-1" name="q-1"><label for="o1_q-1">No</label></div>
        <div><input type="radio" id="o2_q-1" name="q-1"><label for="o2_q-1">Yes</label></div>
      </fieldset>`),
    );
    expect(grouped.fields).toEqual([
      expect.objectContaining({
        label: "Will you now or in the future require visa sponsorship?",
        type: "radio",
        options: ["No", "Yes"],
      }),
    ]);
  });

  it("detects a CAPTCHA challenge without interacting with it", () => {
    for (const html of [
      '<div class="g-recaptcha" data-sitekey="k"></div>',
      '<iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe>',
      '<div id="hcaptcha-box"></div>',
    ]) {
      expect(extractGenericForm(page(`${BASIC}${html}`)).challengePresent).toBe(true);
    }
  });

  it("hashes structure only, so typed values never change it but a changed form does", () => {
    const typed = extractGenericForm(
      page(BASIC.replace('name="first_name" required', 'name="first_name" value="Typed" required')),
    );
    expect(formStructureHash(typed)).toBe(formStructureHash(form));
    const relabeled = extractGenericForm(page(BASIC.replace("First name *", "Given name *")));
    expect(formStructureHash(relabeled)).not.toBe(formStructureHash(form));
    const newOption = extractGenericForm(
      page(
        BASIC.replace(
          "<option>No</option></select>",
          "<option>No</option><option>Maybe</option></select>",
        ),
      ),
    );
    expect(formStructureHash(newOption)).not.toBe(formStructureHash(form));
    const challenged = extractGenericForm(page(`${BASIC}<div class="g-recaptcha"></div>`));
    expect(formStructureHash(challenged)).not.toBe(formStructureHash(form));
  });

  it("accepts exactly 200 fields but refuses a partial model when another field follows", () => {
    const maximum = Array.from({ length: 200 }, (_, index) => `<input name="f${index}">`).join("");
    expect(extractGenericForm(page(maximum)).fields).toHaveLength(200);
    expect(() => extractGenericForm(page(`${maximum}<input name="email" required>`))).toThrow(
      "Application form fields exceed extraction limit",
    );
    expect(
      extractGenericForm(page(`${maximum}<input type="hidden"><button>Submit</button>`)).fields,
    ).toHaveLength(200);
  });

  it("refuses overlong question, control-name and option text instead of hashing a prefix", () => {
    const long = "x".repeat(301);
    for (const html of [
      `<label>${long}<input name="email"></label>`,
      `<input name="${long}" aria-label="Email">`,
      `<select name="email"><option>${long}</option></select>`,
      `<input name="email" aria-label="${long}">`,
      `<span id="a">${"a".repeat(150)}</span><span id="b">${"b".repeat(150)}</span><input aria-labelledby="a b">`,
    ]) {
      expect(() => extractGenericForm(page(html))).toThrow(
        "Application form text exceeds extraction limit",
      );
    }
    expect(
      extractGenericForm(page(`<input aria-label="${"a".repeat(300)}">`)).fields[0]?.label,
    ).toHaveLength(300);
  });

  it("refuses a select whose hidden suffix could change an otherwise matching option", () => {
    const options = Array.from({ length: 250 }, (_, i) => `<option>Option ${i}</option>`).join("");
    expect(extractGenericForm(page(`<select>${options}</select>`)).fields[0]?.options).toHaveLength(
      250,
    );
    expect(() =>
      extractGenericForm(page(`<select>${options}<option>Option 0</option></select>`)),
    ).toThrow("Application form options exceed extraction limit");
  });

  it("refuses an oversized radio group instead of dropping later options", () => {
    const radios = Array.from(
      { length: 250 },
      (_, i) => `<label>Option ${i}<input type="radio" name="choice"></label>`,
    ).join("");
    expect(extractGenericForm(page(radios)).fields[0]?.options).toHaveLength(250);
    expect(() => extractGenericForm(page(`${radios}<input type="radio" name="choice">`))).toThrow(
      "Application form options exceed extraction limit",
    );
  });

  it("processes the last field's remaining radios and preserves requiredness of later members", () => {
    const prefix = Array.from({ length: 199 }, (_, i) => `<input name="f${i}">`).join("");
    const form = extractGenericForm(
      page(`${prefix}<fieldset><legend>Unknown question</legend>
      <label>One<input type="radio" name="choice"></label>
      <label>Two<input type="radio" name="choice" required></label></fieldset>`),
    );
    expect(form.fields[199]).toMatchObject({ options: ["One", "Two"], required: true });
    expect(
      buildFillPlan(form, [], { resume: false, coverLetter: false }).unresolvedRequired,
    ).toContain("f199");
  });
});

describe("field mapping", () => {
  it("refuses conflicting label/name claims, including sensitive and direct-action controls", () => {
    for (const html of [
      '<label>Phone <input name="email" required></label>',
      '<label>Do you require sponsorship? <input name="email" required></label>',
      '<label>I certify this is accurate <input type="checkbox" name="email" required></label>',
      '<label>Email and phone <input name="answer" required></label>',
    ]) {
      const form = extractGenericForm(page(html));
      expect(mapFormFields(form)).toEqual([
        { ref: "f0", fieldKey: null, confidence: 0, reason: "ambiguous" },
      ]);
      expect(
        buildFillPlan(
          form,
          [{ fieldKey: "contact.email", value: "alex@example.test", needsUserAction: false }],
          { resume: false, coverLetter: false },
        ).actions,
      ).toEqual([{ kind: "require_user", ref: "f0", fieldKey: null, reason: "ambiguous_mapping" }]);
      expect(planAssistedManual(form).suggestions).toEqual([]);
    }
  });

  it("keeps competing claims ambiguous even when one control also claims a different key", () => {
    const form = extractGenericForm(
      page('<label>Phone <input name="email"></label><label>Email <input name="address"></label>'),
    );
    expect(mapFormFields(form).map((entry) => entry.reason)).toEqual(["ambiguous", "ambiguous"]);
  });

  it("maps common labels, including sensitive keys, so they are recognized", () => {
    const form = extractGenericForm(page(BASIC));
    const keys = mapFormFields(form).map((mapping) => mapping.fieldKey);
    expect(keys).toEqual([
      "identity.legal_name.first",
      "identity.legal_name.last",
      "contact.email",
      "links.linkedin",
      "authorization.us_authorized",
      "authorization.sponsorship_required",
      "documents.resume",
      "attestation.truthful",
      null,
    ]);
  });

  it("refuses to pick between two controls that claim the same key", () => {
    const form = extractGenericForm(
      page('<label>Email <input name="a"></label><label>Confirm email <input name="b"></label>'),
    );
    expect(mapFormFields(form).map((mapping) => [mapping.fieldKey, mapping.reason])).toEqual([
      [null, "ambiguous"],
      [null, "ambiguous"],
    ]);
  });
});

describe("fill plan", () => {
  const form = extractGenericForm(page(BASIC));
  const packet: PacketValue[] = [
    { fieldKey: "identity.legal_name.first", value: "Alex", needsUserAction: false },
    { fieldKey: "identity.legal_name.last", value: "Example", needsUserAction: false },
    { fieldKey: "contact.email", value: "alex@example.test", needsUserAction: false },
    { fieldKey: "authorization.us_authorized", value: "yes", needsUserAction: false },
    { fieldKey: "authorization.sponsorship_required", value: "Perhaps", needsUserAction: false },
    { fieldKey: "attestation.truthful", value: true, needsUserAction: true },
  ];

  it("fills only approved exact values and hands everything else to the candidate", () => {
    const plan = buildFillPlan(form, packet, { resume: true, coverLetter: false });
    const byRef = new Map(plan.actions.map((action) => [action.ref, action]));
    expect(byRef.get("f0")).toMatchObject({ kind: "fill", value: "Alex" });
    expect(byRef.get("f2")).toMatchObject({ kind: "fill", value: "alex@example.test" });
    // Restricted answers always require candidate action, including previously reviewed values.
    expect(byRef.get("f4")).toMatchObject({ kind: "require_user", reason: "direct_action_field" });
    expect(byRef.get("f5")).toMatchObject({ kind: "require_user", reason: "direct_action_field" });
    expect(byRef.get("f6")).toMatchObject({
      kind: "attach_artifact",
      fieldKey: "documents.resume",
    });
    // Attestations are direct candidate actions even when the packet holds a value.
    expect(byRef.get("f7")).toMatchObject({ kind: "require_user", reason: "direct_action_field" });
    expect(byRef.get("f3")).toMatchObject({ kind: "require_user", reason: "no_packet_value" });
    expect(byRef.get("f8")).toMatchObject({ kind: "skip", reason: "unmapped_optional" });
    expect(plan.unresolvedRequired).toEqual(["f4", "f7"]);
    expect(plan.requiresTakeover).toBe(false);
  });

  it("requires a resume artifact to attach and never fabricates a file", () => {
    const plan = buildFillPlan(form, packet, { resume: false, coverLetter: false });
    expect(plan.actions.find((action) => action.ref === "f6")).toMatchObject({
      kind: "require_user",
      reason: "no_packet_value",
    });
    expect(plan.unresolvedRequired).toContain("f6");
  });

  it("still prepares the form but forces takeover when a challenge is present", () => {
    const challenged = extractGenericForm(page(`${BASIC}<div class="g-recaptcha"></div>`));
    const plan = buildFillPlan(challenged, packet, { resume: true, coverLetter: false });
    const ordinary = buildFillPlan(form, packet, { resume: true, coverLetter: false });
    expect(plan.requiresTakeover).toBe(true);
    expect(ordinary.requiresTakeover).toBe(false);
    expect(plan.actions).toEqual(ordinary.actions);
    expect(plan.unresolvedRequired).toEqual(ordinary.unresolvedRequired);
    expect(plan.actions.some((action) => action.kind === "attach_artifact")).toBe(true);
  });

  it("refuses duplicate option labels after normalization instead of choosing the first", () => {
    for (const html of [
      '<label for="site">Website</label><select id="site" required><option>Example</option><option> EXAMPLE </option></select>',
      '<fieldset><legend>Website</legend><label><input type="radio" name="site" required>Example</label><label><input type="radio" name="site"> EXAMPLE </label></fieldset>',
    ]) {
      const form = extractGenericForm(page(html));
      const plan = buildFillPlan(
        form,
        [{ fieldKey: "links.portfolio", value: "example", needsUserAction: false }],
        { resume: false, coverLetter: false },
      );
      expect(plan.actions).toEqual([
        {
          kind: "require_user",
          ref: "f0",
          fieldKey: "links.portfolio",
          reason: "option_not_found",
        },
      ]);
      expect(plan.unresolvedRequired).toEqual(["f0"]);
    }
  });

  it("never fills restricted answers or signatures even when supplied and reviewed in the packet", () => {
    const cases = [
      ["Work authorization", "authorization.us_authorized"],
      ["Sponsorship", "authorization.sponsorship_required"],
      ["Export control", "authorization.export_control"],
      ["Gender", "demographic.gender"],
      ["Race", "demographic.race_ethnicity"],
      ["Veteran", "demographic.veteran"],
      ["Disability", "demographic.disability"],
      ["Signature", "signature.electronic"],
    ];
    for (const [label, fieldKey] of cases) {
      const form = extractGenericForm(page(`<label>${label}<input required></label>`));
      const plan = buildFillPlan(
        form,
        [
          {
            fieldKey: fieldKey as string,
            value: "Candidate-reviewed answer",
            needsUserAction: false,
          },
        ],
        { resume: false, coverLetter: false },
      );
      expect(plan.actions).toEqual([
        { kind: "require_user", ref: "f0", fieldKey, reason: "direct_action_field" },
      ]);
      expect(plan.unresolvedRequired).toEqual(["f0"]);
    }
  });

  it("selects a single exact normalized non-sensitive option and refuses a nearest match", () => {
    const form = extractGenericForm(
      page(
        '<label for="site">Website</label><select id="site" required><option>Example</option><option>Other</option></select>',
      ),
    );
    const plan = (value: string) =>
      buildFillPlan(form, [{ fieldKey: "links.portfolio", value, needsUserAction: false }], {
        resume: false,
        coverLetter: false,
      });
    expect(plan(" EXAMPLE ").actions).toEqual([
      { kind: "select", ref: "f0", fieldKey: "links.portfolio", option: "Example" },
    ]);
    expect(plan("Exampl").actions[0]).toMatchObject({
      kind: "require_user",
      reason: "option_not_found",
    });
  });

  it("does not plan a value the packet marks as needing candidate action", () => {
    const plan = buildFillPlan(
      form,
      [{ fieldKey: "contact.email", value: null, needsUserAction: true }],
      { resume: false, coverLetter: false },
    );
    expect(plan.actions.find((action) => action.ref === "f2")).toMatchObject({
      kind: "require_user",
      reason: "needs_user_action",
    });
  });

  it("falls back to assisted manual mode on an unknown site: no page action, no submission", () => {
    const assisted = planAssistedManual(form);
    expect(assisted).toMatchObject({
      mode: "assisted_manual",
      performsPageActions: false,
      submissionAllowed: false,
      requiresTakeover: false,
    });
    expect(assisted.suggestions.map((suggestion) => suggestion.fieldKey)).toContain(
      "contact.email",
    );
    expect(assisted.unmatched).toContain("f8");
  });
});

describe("adapter registry gate", () => {
  const now = new Date("2026-09-18T12:00:00.000Z");
  const evidence: FixtureEvidence = {
    kind: "provider_derived",
    authorizationRecordId: "auth-1",
    sanitizationScanPassedAt: "2026-09-10T00:00:00.000Z",
    qaRepresentativenessAcceptedAt: "2026-09-11T00:00:00.000Z",
    expiresAt: "2026-12-01T00:00:00.000Z",
    variantIds: ["board-v1"],
  };
  const declarations = ADAPTER_DECLARATIONS.map((declaration) =>
    declaration.provider === "greenhouse"
      ? { ...declaration, variants: ["board-v1"] }
      : declaration,
  );
  const registry = (controls: ConstructorParameters<typeof AdapterRegistry>[1]) =>
    new AdapterRegistry(declarations, controls);
  const id = "greenhouse-application-v1";

  it("is off by default for every declared adapter", () => {
    const defaults = new AdapterRegistry();
    for (const declaration of ADAPTER_DECLARATIONS) {
      expect(defaults.status(declaration.id, "board-v1", now)).toEqual({
        mode: "off",
        reasons: ["kill_switch_off"],
      });
    }
    expect(defaults.status("nope", "x", now).reasons).toEqual(["unknown_adapter"]);
  });

  it("offers generic suggestions when switched on, without any page action approval", () => {
    expect(
      registry({
        enabled: { "generic-assisted-v1": true },
        liveEffectsApproved: false,
        fixtureEvidence: {},
      }).status("generic-assisted-v1", "generic", now).mode,
    ).toBe("suggest_only");
  });

  it("never autofills a provider adapter without approval and accepted provider fixtures", () => {
    const enabled = { [id]: true };
    const status = (
      controls: ConstructorParameters<typeof AdapterRegistry>[1],
      variant = "board-v1",
    ) => registry(controls).status(id, variant, now);
    expect(
      status({ enabled, liveEffectsApproved: false, fixtureEvidence: { [id]: evidence } }).reasons,
    ).toContain("live_effects_not_approved");
    expect(status({ enabled, liveEffectsApproved: true, fixtureEvidence: {} }).reasons).toContain(
      "no_fixture_evidence",
    );
    // Synthetic fixtures can never satisfy the provider evidence gate.
    expect(
      status({
        enabled,
        liveEffectsApproved: true,
        fixtureEvidence: { [id]: { ...evidence, kind: "synthetic" } },
      }).reasons,
    ).toContain("fixture_evidence_not_provider_derived");
    expect(
      status({
        enabled,
        liveEffectsApproved: true,
        fixtureEvidence: { [id]: { ...evidence, qaRepresentativenessAcceptedAt: "" } },
      }).reasons,
    ).toContain("fixture_qa_acceptance_missing");
    expect(
      status({
        enabled,
        liveEffectsApproved: true,
        fixtureEvidence: { [id]: { ...evidence, expiresAt: "2026-09-01T00:00:00.000Z" } },
      }).reasons,
    ).toContain("fixture_evidence_expired");
    expect(
      status(
        { enabled, liveEffectsApproved: true, fixtureEvidence: { [id]: evidence } },
        "board-v2",
      ).reasons,
    ).toContain("variant_not_covered");
    expect(
      status({ enabled, liveEffectsApproved: true, fixtureEvidence: { [id]: evidence } }),
    ).toEqual({
      mode: "autofill",
      reasons: [],
    });
    // The kill switch still wins over full evidence.
    expect(
      registry({
        enabled: {},
        liveEffectsApproved: true,
        fixtureEvidence: { [id]: evidence },
      }).status(id, "board-v1", now).mode,
    ).toBe("off");
  });

  it("declares the three provider adapters with no supported variants until fixtures exist", () => {
    for (const provider of ["greenhouse", "lever", "ashby"]) {
      const declaration = ADAPTER_DECLARATIONS.find((entry) => entry.provider === provider);
      expect(declaration?.variants).toEqual([]);
    }
  });
});

describe("page fit for real application pages (ADR-053)", () => {
  // Structure modeled on read-only inspection of public Greenhouse and Ashby pages on 2026-10-22.
  const mount = (html: string) => {
    document.body.innerHTML = `<form>${html}</form>`;
    return document.body;
  };
  const invisibleBadge =
    '<div class="grecaptcha-badge"><iframe src="https://www.recaptcha.net/recaptcha/enterprise/anchor"></iframe></div><textarea id="g-recaptcha-response-100000" class="g-recaptcha-response"></textarea>';
  const hiddenChallenge =
    '<div style="visibility:hidden;opacity:0"><iframe title="recaptcha challenge expires in two minutes" src="https://www.recaptcha.net/recaptcha/enterprise/bframe"></iframe></div>';
  const visibleChallenge =
    '<div><iframe title="recaptcha challenge expires in two minutes" src="https://www.recaptcha.net/recaptcha/enterprise/bframe"></iframe></div>';

  it.each([
    ["the invisible badge and response field", invisibleBadge, false],
    ["the badge with a hidden challenge frame", invisibleBadge + hiddenChallenge, false],
    [
      "an invisible widget on a button",
      '<button class="g-recaptcha" data-sitekey="k" data-size="invisible">Go</button>',
      false,
    ],
    ["a visible challenge frame", invisibleBadge + visibleChallenge, true],
    ["a checkbox widget", '<div class="g-recaptcha" data-sitekey="k"></div>', true],
    ["hCaptcha", '<iframe src="https://newassets.hcaptcha.com/captcha/v1"></iframe>', true],
    ["Turnstile", '<div class="cf-turnstile"></div>', true],
  ])("classifies %s", (_name, html, expected) => {
    const root = mount(`<input name="a">${html}`);
    expect(extractGenericForm(root).challengePresent).toBe(expected);
    // The exported classifier and the copy serialized into the page must agree.
    expect(interactiveCaptchaPresent(root)).toBe(expected);
  });

  it("ignores a hidden validation shim and leaves a custom combobox to the candidate", () => {
    const root = mount(
      `<div><label id="q-label" for="question_1">Do you require visa sponsorship? *</label>
         <input id="question_1" type="text" role="combobox" aria-haspopup="true" aria-required="true">
         <input required tabindex="-1" aria-hidden="true" value=""></div>
       <label for="email">Email</label><input id="email" type="text" autocomplete="email" aria-required="true">`,
    );
    const form = extractGenericForm(root);
    expect(form.fields.map((field) => [field.name, field.type, field.required])).toEqual([
      ["question_1", "unknown", true],
      ["email", "text", true],
    ]);
    const plan = buildFillPlan(
      form,
      [{ fieldKey: "contact.email", value: "a@example.invalid", needsUserAction: false }],
      { resume: false, coverLetter: false },
    );
    expect(plan.actions.filter((action) => action.kind === "fill")).toHaveLength(1);
    // Never filled; handed back to the candidate.
    expect(plan.actions.find((action) => action.ref === "f0")?.kind).toBe("require_user");
  });
});
