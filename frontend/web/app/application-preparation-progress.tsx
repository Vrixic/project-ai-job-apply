"use client";

import type { Application, ApplicationPacketPreparation } from "@ai-job-apply/api-contracts";
import { useEffect, useState } from "react";
import { readApplicationPreparation } from "../lib/application-preparation-client";
import { applicationsCall } from "../lib/applications-client";

const maximumReads = 120;
const maximumPollingMs = 240_000;
const pollIntervalMs = 2_000;

/** Polls only the accepted operation. A status retry never starts or redispatches generation. */
export function ApplicationPreparationProgress({
  preparation,
  onResolved,
  fetchImplementation,
}: {
  preparation: ApplicationPacketPreparation;
  onResolved(operation: ApplicationPacketPreparation, current: Application): void;
  fetchImplementation?: typeof globalThis.fetch;
}) {
  const [cycle, setCycle] = useState(0);
  const [paused, setPaused] = useState(false);
  const [state, setState] = useState(preparation.state);
  const [message, setMessage] = useState<string>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: an explicit status-check retry starts a new bounded read cycle.
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wake: (() => void) | undefined;
    const options = {
      signal: controller.signal,
      ...(fetchImplementation ? { fetch: fetchImplementation } : {}),
    };
    const pause = (copy: string) => {
      if (controller.signal.aborted) return;
      setMessage(copy);
      setPaused(true);
    };
    const endTimer = setTimeout(() => {
      pause(
        "Status checking paused. Check the same preparation again; no new draft will be requested.",
      );
      controller.abort();
      wake?.();
    }, maximumPollingMs);
    setPaused(false);
    setMessage(undefined);
    void (async () => {
      const deadline = Date.now() + maximumPollingMs;
      let operation = preparation;
      for (let read = 0; read < maximumReads && Date.now() < deadline; read += 1) {
        if (controller.signal.aborted) return;
        if (operation.state === "succeeded" || operation.state === "failed") {
          const current = await applicationsCall(
            "GET",
            `/api/platform/applications/${operation.applicationId}`,
            options,
          );
          if (controller.signal.aborted) return;
          if (!current.ok || current.application.id !== operation.applicationId) {
            pause(
              "Preparation ended, but we could not read the current application. Check its status again.",
            );
            return;
          }
          if (
            operation.result &&
            (current.application.revision < operation.result.revision ||
              (current.application.revision === operation.result.revision &&
                current.application.currentPacket?.id !== operation.result.packetId))
          ) {
            pause(
              "The prepared packet could not be verified against the current application. Check its status again.",
            );
            return;
          }
          onResolved(operation, current.application);
          return;
        }
        const result = await readApplicationPreparation(
          operation.applicationId,
          operation.id,
          options,
        );
        if (controller.signal.aborted) return;
        if (!result.ok || result.kind !== "preparation") {
          pause(
            "We could not check preparation. Check the same operation again; no new generation will start.",
          );
          return;
        }
        operation = result.preparation;
        setState(operation.state);
        if (operation.state === "queued" || operation.state === "running")
          await new Promise<void>((resolve) => {
            wake = resolve;
            timer = setTimeout(resolve, pollIntervalMs);
          });
      }
      pause(
        "Preparation is still pending. Check its status again; this does not request another draft.",
      );
    })();
    return () => {
      controller.abort();
      clearTimeout(endTimer);
      clearTimeout(timer);
      wake?.();
    };
  }, [preparation, cycle, onResolved, fetchImplementation]);

  return (
    <section aria-label="Application preparation status">
      <p role="status">
        {message ??
          (state === "queued" ? "Preparation queued." : "Preparing your resume and cover letter.")}
      </p>
      <p>Nothing is submitted. Closing this page stops status checks; server work may continue.</p>
      {paused ? (
        <button type="button" onClick={() => setCycle((current) => current + 1)}>
          Check preparation status
        </button>
      ) : null}
    </section>
  );
}
