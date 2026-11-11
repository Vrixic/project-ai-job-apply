import { describe, expect, it } from "vitest";
import { linkedJob } from "./linked-job";

const JOB = "00000000-0000-7000-8000-000000000001";
const APPLICATION = "00000000-0000-7000-8000-000000000002";

describe("linkedJob", () => {
  it("takes a job alone as that job's own page", () => {
    expect(linkedJob({ job: JOB })).toEqual({ jobId: JOB });
  });

  it("takes a job with its application", () => {
    expect(linkedJob({ job: JOB, application: APPLICATION })).toEqual({
      jobId: JOB,
      applicationId: APPLICATION,
    });
  });

  it.each([
    ["no parameters", {}],
    ["an application without its job", { application: APPLICATION }],
    ["a job that is not an identifier", { job: "not-a-job" }],
    ["an application that is not an identifier", { job: JOB, application: "nope" }],
    ["a repeated job", { job: [JOB, JOB] }],
    ["a repeated application", { job: JOB, application: [APPLICATION, APPLICATION] }],
    ["another parameter", { job: JOB, q: "engineer" }],
    ["an empty job", { job: "" }],
  ])("is no link for %s", (_name, query) => {
    expect(linkedJob(query)).toBeUndefined();
  });
});
