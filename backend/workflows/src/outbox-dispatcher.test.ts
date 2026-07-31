import type { ProfileStore } from "@ai-job-apply/profile-service";
import type { Client } from "@temporalio/client";
import type { Logger } from "pino";
import { describe, expect, it, vi } from "vitest";

const tracing = vi.hoisted(() => ({
  activeTraceparent: vi.fn(() => "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01"),
  withTraceSpan: vi.fn(
    async (_name: string, _traceparent: string | undefined, work: () => Promise<unknown>) => work(),
  ),
}));

vi.mock("@ai-job-apply/observability", () => tracing);

import { eventTypes } from "@ai-job-apply/event-contracts";
import { OutboxDispatcher } from "./outbox-dispatcher.js";

const preferenceEvent = {
  id: "018f47a5-7b70-7cc2-a999-c343b7d2fdf6",
  type: eventTypes.profilePreferencesUpdated,
  subject: "preference-set/018f47a5-7b70-7cc2-a999-c343b7d2fdf7",
  data: {
    preferenceSetId: "018f47a5-7b70-7cc2-a999-c343b7d2fdf7",
    version: 1,
    operationId: "018f47a5-7b70-7cc2-a999-c343b7d2fdf8",
  },
};

describe("OutboxDispatcher", () => {
  it("continues valid event context into Temporal and publishes after start", async () => {
    const eventTraceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    const markOutboxPublished = vi.fn(async () => undefined);
    const store = {
      getPendingOutboxEvents: vi.fn(async () => [
        {
          ...preferenceEvent,
          traceparent: eventTraceparent,
        },
      ]),
      markOutboxPublished,
    } as unknown as ProfileStore;
    const start = vi.fn(async () => undefined);
    const temporal = { workflow: { start } } as unknown as Client;
    const logger = { error: vi.fn() } as unknown as Logger;
    const dispatcher = new OutboxDispatcher(store, temporal, "profile-readiness-v1", logger);

    await dispatcher.dispatchOnce();

    expect(tracing.withTraceSpan).toHaveBeenCalledWith(
      "outbox.dispatch",
      eventTraceparent,
      expect.any(Function),
    );
    expect(start).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        taskQueue: "profile-readiness-v1",
        args: [
          expect.objectContaining({
            traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
          }),
        ],
      }),
    );
    expect(markOutboxPublished).toHaveBeenCalledOnce();
  });

  it("acknowledges terminal result events so they cannot starve newer workflow inputs", async () => {
    const terminalEvents = Array.from({ length: 25 }, (_, index) => ({
      id: `018f47a5-7b70-7cc2-a999-${String(index).padStart(12, "0")}`,
      type: eventTypes.profileReadinessCalculated,
      subject: `operation/018f47a5-7b70-7cc2-a998-${String(index).padStart(12, "0")}`,
      data: {
        preferenceSetId: "018f47a5-7b70-7cc2-a999-c343b7d2fdf7",
        operationId: "018f47a5-7b70-7cc2-a999-c343b7d2fdf8",
        completionPercent: 100,
        missingFields: [],
      },
    }));
    const pendingEvents = [...terminalEvents, preferenceEvent];
    const published = new Set<string>();
    const markOutboxPublished = vi.fn(async (eventId: string) => {
      published.add(eventId);
    });
    const store = {
      getPendingOutboxEvents: vi.fn(async (limit: number) =>
        pendingEvents.filter((event) => !published.has(event.id)).slice(0, limit),
      ),
      markOutboxPublished,
    } as unknown as ProfileStore;
    const start = vi.fn(async () => undefined);
    const temporal = { workflow: { start } } as unknown as Client;
    const logger = { error: vi.fn() } as unknown as Logger;
    const dispatcher = new OutboxDispatcher(store, temporal, "profile-readiness-v1", logger);

    await dispatcher.dispatchOnce();
    await dispatcher.dispatchOnce();

    expect(markOutboxPublished).toHaveBeenCalledTimes(26);
    expect(start).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ workflowId: `profile-readiness/${preferenceEvent.id}` }),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });
});
