// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { extractGenericForm } from "./extract.js";
import { formStructureHash } from "./form-model.js";
import {
  employerPageForSource,
  formStructureDigestInput,
  parseObservedApplicationForm,
} from "./observed-form.js";

const now = 1_800_000_000_000;
function fixture() {
  return {
    schema: "application-observed-form.v1",
    applicationId: "00000000-0000-7000-8000-000000000001",
    jobId: "00000000-0000-7000-8000-000000000002",
    destination: "https://employer.example/jobs/1",
    capturedAt: now,
    form: {
      challengePresent: false,
      fields: [
        {
          ref: "f0",
          label: "Work authorization",
          name: "auth",
          type: "select",
          required: true,
          options: ["Yes", "No"],
        },
      ],
    },
  };
}
describe("bounded observed structure", () => {
  it("preserves the existing hash algorithm without browser Node crypto", () => {
    const value = parseObservedApplicationForm(JSON.stringify(fixture()), now);
    expect(value).toBeDefined();
    if (!value) throw new Error();
    expect(createHash("sha256").update(formStructureDigestInput(value.form)).digest("hex")).toBe(
      formStructureHash(value.form),
    );
    expect(formStructureHash(value.form)).toBe(
      createHash("sha256")
        .update(
          JSON.stringify({
            v: 1,
            challenge: false,
            fields: [["work authorization", "auth", "select", true, ["yes", "no"]]],
          }),
        )
        .digest("hex"),
    );
  });
  it.each(["value", "defaultValue", "checked", "files", "selectedIndex"])(
    "refuses value-bearing %s rather than stripping it",
    (key) => {
      const value = fixture();
      Object.assign(value.form.fields[0] ?? {}, { [key]: "PRIVATE" });
      expect(parseObservedApplicationForm(JSON.stringify(value), now)).toBeUndefined();
    },
  );
  it("refuses stale/future/challenge/duplicate/oversized/unknown structures", () => {
    for (const mutate of [
      (v: ReturnType<typeof fixture>) => {
        v.capturedAt = now - 60_000;
      },
      (v: ReturnType<typeof fixture>) => {
        v.capturedAt = now + 1;
      },
      (v: ReturnType<typeof fixture>) => {
        v.form.challengePresent = true;
      },
      (v: ReturnType<typeof fixture>) => {
        v.destination += "#application";
      },
      (v: ReturnType<typeof fixture>) => {
        const field = v.form.fields[0];
        if (!field) throw new Error();
        v.form.fields.push(field);
      },
      (v: ReturnType<typeof fixture>) => {
        const field = v.form.fields[0];
        if (!field) throw new Error();
        field.label = "x".repeat(301);
      },
      (v: ReturnType<typeof fixture>) => {
        const field = v.form.fields[0];
        if (!field) throw new Error();
        field.options = Array(251).fill("x");
      },
      (v: ReturnType<typeof fixture>) => {
        const field = v.form.fields[0];
        if (!field) throw new Error();
        field.type = "submit";
      },
    ]) {
      const value = fixture();
      mutate(value);
      expect(parseObservedApplicationForm(JSON.stringify(value), now)).toBeUndefined();
    }
    expect(parseObservedApplicationForm(" ".repeat(65_537), now)).toBeUndefined();
    expect(
      parseObservedApplicationForm(JSON.stringify({ ...fixture(), token: "PRIVATE" }), now),
    ).toBeUndefined();
  });
  it("serializes into an isolated injection without reading control contents or values", () => {
    const doc = new DOMParser().parseFromString(
      '<form><label>Work authorization <textarea>PRIVATE_INITIAL_TEXT</textarea></label><label for="q">Sponsorship</label><input id="q" value="PRIVATE_VALUE"><label id="external">Gender <select><option>PRIVATE_OPTION_IN_LABEL</option></select></label><input aria-labelledby="external"><input type="password" value="PRIVATE_PASSWORD"></form>',
      "text/html",
    );
    // Chrome serializes func; this intentionally has no access to module-scope helpers.
    const injected = new Function(
      `return (${extractGenericForm.toString()})`,
    )() as typeof extractGenericForm;
    const form = injected(doc);
    expect(form.fields.map((field) => field.label)).toEqual([
      "Work authorization",
      "Sponsorship",
      "Gender",
      "Gender",
    ]);
    expect(JSON.stringify(form)).not.toContain("PRIVATE_INITIAL_TEXT");
    expect(JSON.stringify(form)).not.toContain("PRIVATE_VALUE");
    expect(JSON.stringify(form)).not.toContain("PRIVATE_PASSWORD");
    expect(form.fields.at(-1)?.label).not.toContain("PRIVATE_OPTION_IN_LABEL");
  });
});

describe("employerPageForSource", () => {
  const ashby = "https://jobs.ashbyhq.com/Mintlify/ec55d98f-6e94-4ffb-9a55-4adad39297c3";
  it("binds the exact source page unchanged", () => {
    expect(employerPageForSource(ashby, ashby)).toBe(ashby);
    expect(
      employerPageForSource(
        "https://boards.greenhouse.io/x/jobs/1",
        "https://boards.greenhouse.io/x/jobs/1",
      ),
    ).toBe("https://boards.greenhouse.io/x/jobs/1");
  });
  it("binds the same posting's Ashby and Lever application subpage without its query", () => {
    expect(employerPageForSource(ashby, `${ashby}/application?jr_id=tracking`)).toBe(
      `${ashby}/application`,
    );
    expect(
      employerPageForSource(
        "https://jobs.lever.co/acme/123",
        "https://jobs.lever.co/acme/123/apply",
      ),
    ).toBe("https://jobs.lever.co/acme/123/apply");
  });
  it("refuses other postings, providers, origins, schemes, fragments and credentials", () => {
    for (const page of [
      "https://jobs.ashbyhq.com/Mintlify/00000000-0000-0000-0000-000000000000/application",
      `${ashby}/applications`,
      `${ashby}/application/extra`,
      `${ashby}/apply`,
      `https://evil.example/Mintlify/ec55d98f-6e94-4ffb-9a55-4adad39297c3/application`,
      `http://jobs.ashbyhq.com/Mintlify/ec55d98f-6e94-4ffb-9a55-4adad39297c3/application`,
      `${ashby}/application#x`,
      `https://user@jobs.ashbyhq.com/Mintlify/ec55d98f-6e94-4ffb-9a55-4adad39297c3/application`,
      "not a url",
    ])
      expect(employerPageForSource(ashby, page)).toBeUndefined();
    expect(
      employerPageForSource(
        "https://boards.greenhouse.io/x/jobs/1",
        "https://boards.greenhouse.io/x/jobs/1/application",
      ),
    ).toBeUndefined();
    expect(employerPageForSource(`${ashby}?src=a`, `${ashby}/application`)).toBeUndefined();
  });
});
