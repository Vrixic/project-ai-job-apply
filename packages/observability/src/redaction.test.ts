import { Writable } from "node:stream";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { PRIVACY_REDACTION_PATHS } from "./index.js";

describe("logging policy", () => {
  it("redacts candidate values and credentials", async () => {
    let output = "";
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });
    const logger = pino(
      {
        redact: {
          paths: [...PRIVACY_REDACTION_PATHS],
          censor: "[REDACTED]",
        },
      },
      destination,
    );

    const reauthenticationCanary = "private.header.signature";
    logger.info({
      req: {
        headers: {
          authorization: "Bearer secret",
          "x-ai-job-apply-reauthentication": reauthenticationCanary,
        },
      },
      request: {
        headers: {
          authorization: "Bearer other-secret",
          "x-ai-job-apply-reauthentication": reauthenticationCanary,
        },
      },
      targetRoles: ["Private role"],
      email: "private@example.test",
    });

    expect(output).not.toContain("secret");
    expect(output).not.toContain("Private role");
    expect(output).not.toContain("private@example.test");
    expect(output).not.toContain(reauthenticationCanary);
  });
});
