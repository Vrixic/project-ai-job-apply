import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import {
  createConsentGrantRequest,
  createContributionRequest,
  prepareContribution,
} from "../lib/job-intent-api";
import { createPendingIntent } from "../lib/pending-queue";

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

describe("authenticated contribution redirect boundary", () => {
  it("refuses real cross-origin 307 redirects for both requests without contacting the redirect target", async () => {
    let targetRequests = 0;
    let originRequests = 0;
    const target = createServer((_request, response) => {
      targetRequests++;
      response.writeHead(200).end();
    });
    const origin = createServer((_request, response) => {
      originRequests++;
      response.writeHead(307, { location: targetOrigin }).end();
    });
    let targetOrigin = "";
    try {
      targetOrigin = await listen(target);
      const apiOrigin = await listen(origin);
      const pending = createPendingIntent({
        approvedFields: ["title"],
        identityFence: "synthetic-account",
        intent: "contribute",
        retentionMilliseconds: 86_400_000,
        capture: {
          adapterVersion: "d2-job-page-v1",
          capturedAt: "2026-09-08T12:00:00.000Z",
          pageVariant: "greenhouse-board-v1",
          provider: "greenhouse",
          sourceUrl: "https://job-boards.greenhouse.io/synthetic/jobs/123",
          title: "Synthetic job",
        },
      });
      const prepared = await prepareContribution(pending, "synthetic-policy-v1", "0.2.0");
      const consent = {
        id: "01991000-0000-7000-8000-000000000099",
        grantedAt: "2026-09-08T12:00:01.000Z",
        previewDigestSha256: prepared.previewDigestSha256,
      };
      const requests = [
        createConsentGrantRequest(
          pending,
          prepared.previewDigestSha256,
          "synthetic-token",
          apiOrigin,
          "synthetic-policy-v1",
        ),
        createContributionRequest(pending, prepared.body, consent, "synthetic-token", apiOrigin),
      ];
      for (const request of requests) {
        expect(request.init.redirect).toBe("error");
        await expect(
          fetch(request.url, { ...request.init, signal: AbortSignal.timeout(5000) }),
        ).rejects.toThrow();
      }
      expect(originRequests).toBe(2);
      expect(targetRequests).toBe(0);
    } finally {
      await Promise.all([close(origin), close(target)]);
    }
  });
});
