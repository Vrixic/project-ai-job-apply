import { randomUUID } from "node:crypto";
import { temporaryResponseGuard } from "@ai-job-apply/applications-service";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

/** These guards cover the serialization gap; they do not certify socket delivery, remote
 * settlement or client/native-worker copy disposal. No generated content is logged or cached. */
export function installTemporaryMaterialResponseGuards(server: FastifyInstance): void {
  const replies = new WeakMap<FastifyReply, () => boolean>();
  const expired = (request: FastifyRequest, reply: FastifyReply) => {
    reply.code(409).type("application/problem+json").header("cache-control", "no-store");
    reply.removeHeader("content-length");
    return {
      type: "urn:ai-job-apply:problem:application_packet_stale",
      code: "application_packet_stale",
      status: 409,
      title: "Generated material unavailable",
      detail: "Prepare new application materials and review them again",
      traceId: (request as FastifyRequest & { traceId?: string }).traceId ?? randomUUID(),
    };
  };
  server.addHook("preSerialization", async (request, reply, payload) => {
    const guard = temporaryResponseGuard(payload);
    if (!guard) return payload;
    reply.header("cache-control", "no-store");
    if (!guard()) return expired(request, reply);
    replies.set(reply, guard);
    return payload;
  });
  server.addHook("onSend", async (request, reply, payload) => {
    const guard = replies.get(reply);
    replies.delete(reply);
    if (guard && !guard()) return JSON.stringify(expired(request, reply));
    return payload;
  });
}
