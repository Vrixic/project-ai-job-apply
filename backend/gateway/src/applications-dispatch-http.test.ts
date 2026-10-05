import { StalePacketError } from "@ai-job-apply/applications-service";
import { describe, expect, it } from "vitest";
import { projectApplicationsFailure } from "./applications-http.js";

describe("submission dispatch refusal problem projection", () => {
  it("explains expired approval with the existing fixed conflict code", () => {
    const failure = new StalePacketError(["approval_expired"]);
    failure.message = "synthetic private candidate detail";
    const result = projectApplicationsFailure(failure);
    expect(result).toEqual({
      status: 409,
      code: "application_packet_stale",
      title: "Approval expired",
      detail: "The packet approval expired; review and approve it again",
    });
    expect(JSON.stringify(result)).not.toContain(failure.message);
  });

  it.each([["job_changed"], ["approval_expired", "resume_changed"]] as const)(
    "keeps material changes on the existing new-packet conflict path: %s",
    (...reasons) => {
      const result = projectApplicationsFailure(new StalePacketError(reasons));
      expect(result).toEqual({
        status: 409,
        code: "application_packet_stale",
        title: "Packet is stale",
        detail: "The job, form, or documents changed; prepare a new packet",
      });
    },
  );
});
