import { randomUUID } from "node:crypto";
import {
  type TemporaryResponseControl,
  temporaryResponseControl,
} from "@ai-job-apply/applications-service";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

/** These guards cover the serialization gap; they do not certify socket delivery, remote
 * settlement or client/native-worker copy disposal. No generated content is logged or cached. */
const requests = new WeakMap<FastifyRequest, { controller: AbortController; close(): void }>();

export function temporaryMaterialRequestSignal(request: FastifyRequest): AbortSignal {
  const existing = requests.get(request);
  if (existing) return existing.controller.signal;
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.raw.once("aborted", abort);
  request.raw.socket?.once("close", abort);
  if (request.raw.aborted || request.raw.socket?.destroyed) abort();
  requests.set(request, {
    controller,
    close: () => {
      request.raw.off("aborted", abort);
      request.raw.socket?.off("close", abort);
      requests.delete(request);
    },
  });
  return controller.signal;
}

export function installTemporaryMaterialResponseGuards(server: FastifyInstance): void {
  const replies = new WeakMap<FastifyReply, TemporaryResponseControl>();
  const cleanup = (request: FastifyRequest, reply: FastifyReply) => {
    const control = replies.get(reply);
    replies.delete(reply);
    control?.release();
    requests.get(request)?.close();
  };
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
    const control = temporaryResponseControl(payload);
    if (!control) return payload;
    reply.header("cache-control", "no-store");
    if (!control.isCurrent()) return expired(request, reply);
    replies.set(reply, control);
    reply.raw.once("close", () => cleanup(request, reply));
    return payload;
  });
  server.addHook("onSend", async (request, reply, payload) => {
    const control = replies.get(reply);
    if (control && !control.isCurrent()) return JSON.stringify(expired(request, reply));
    return payload;
  });
  server.addHook("onResponse", async (request, reply) => cleanup(request, reply));
  server.addHook("onError", async (request, reply) => {
    requests.get(request)?.controller.abort();
    cleanup(request, reply);
  });
  server.addHook("onTimeout", async (request, reply) => {
    requests.get(request)?.controller.abort();
    cleanup(request, reply);
  });
}
