import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import pino from "pino";

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
          paths: ["authorization", "targetRoles", "email"],
          censor: "[REDACTED]",
        },
      },
      destination,
    );

    logger.info({
      authorization: "Bearer secret",
      targetRoles: ["Private role"],
      email: "private@example.test",
    });

    expect(output).not.toContain("secret");
    expect(output).not.toContain("Private role");
    expect(output).not.toContain("private@example.test");
  });
});
