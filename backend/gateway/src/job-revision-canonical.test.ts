import { createHash } from "node:crypto";
import { activeJobRevisionDigestInput } from "@ai-job-apply/api-contracts/job-revision-canonical";
import { jobRevisionHash } from "@ai-job-apply/applications-service";
import { describe, expect, it } from "vitest";

describe("shared active job revision bytes", () => {
  it.each([undefined, "Synthetic department", "Unicode \u2603"])(
    "preserves existing packet hashes for %s",
    (department) => {
      const job = {
        id: "synthetic-id",
        company: { id: "synthetic-company", name: "Synthetic Company" },
        title: "Engineer",
        locations: ["One", "Two"],
        ...(department === undefined ? {} : { department }),
      };
      const old = jobRevisionHash({
        id: job.id,
        active: true,
        company: job.company,
        title: job.title,
        locations: job.locations,
        department: job.department ?? null,
      });
      expect(createHash("sha256").update(activeJobRevisionDigestInput(job)).digest("hex")).toBe(
        old,
      );
      expect(activeJobRevisionDigestInput({ ...job, title: "Changed" })).not.toBe(
        activeJobRevisionDigestInput(job),
      );
    },
  );
});
