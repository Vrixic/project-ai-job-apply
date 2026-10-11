"use client";

import type {
  Application,
  ApplicationNativeTransferReceipt,
  ApplicationTemporaryMaterial,
} from "@ai-job-apply/api-contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { materialDeadline } from "../lib/application-material-lifetime";
import { sha256OfBytes } from "../lib/applications-client";
import {
  discardTransferredNativeMaterials,
  type NativeExtensionMessenger,
  nativeExtensionId,
  nativeExtensionMessenger,
  transferApprovedNativeMaterials,
} from "../lib/native-extension-transfer";
import {
  type NativeMaterialValue,
  nativeMaterialReadFailureCopy,
  readNativeMaterial,
} from "../lib/native-material-client";
import {
  type NativeMaterialConfiguration,
  NativeMaterialSession,
} from "../lib/native-material-session";
import {
  announceNativeMaterialSignOut,
  NATIVE_MATERIAL_SIGN_OUT_CHANNEL,
} from "../lib/native-material-sign-out-signal";
import { useMaterialExpiry } from "./use-material-expiry";

function keyed<T>(items: readonly T[], textOf: (item: T) => string) {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const text = textOf(item);
    const count = (seen.get(text) ?? 0) + 1;
    seen.set(text, count);
    return { item, key: `${text}#${count}` };
  });
}

/** Packet-keyed, memory-only preview and approved downloads. Unmount withdraws local access. */
export function NativeApplicationMaterials({
  application,
  configuration,
  busy,
  onReady,
  onUnavailable,
  fetchImplementation,
}: {
  application: Application;
  configuration: NativeMaterialConfiguration;
  busy: boolean;
  onReady(material: ApplicationTemporaryMaterial): void;
  onUnavailable(): void;
  fetchImplementation?: typeof fetch;
}) {
  const [session] = useState(() => new NativeMaterialSession(configuration));
  const [extensionId] = useState(nativeExtensionId);
  const transferred = useRef<
    | {
        messenger: NativeExtensionMessenger;
        extensionId: string;
        receipt: ApplicationNativeTransferReceipt;
      }
    | undefined
  >(undefined);
  const withdrawTransfer = useCallback(() => {
    const previous = transferred.current;
    transferred.current = undefined;
    if (previous)
      discardTransferredNativeMaterials(previous.messenger, previous.extensionId, previous.receipt);
  }, []);
  const [connected, setConnected] = useState(false);
  const [coordinationReady, setCoordinationReady] = useState(false);
  const [credentialDeadline, setCredentialDeadline] = useState<number>();
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string>();
  const [previews, setPreviews] = useState<NativeMaterialValue[]>([]);
  const pending = useRef<AbortController | undefined>(undefined);
  const pendingDownload = useRef<AbortController | undefined>(undefined);
  const mounted = useRef(true);
  const currentApproval = useRef({
    revision: application.revision,
    action: application.currentAction,
  });
  currentApproval.current = { revision: application.revision, action: application.currentAction };
  const packet = application.currentPacket;
  const materials = packet?.temporaryMaterials ?? [];
  const deadline = materials.length ? Math.min(...materials.map(materialDeadline)) : 0;
  const expired = useMaterialExpiry(deadline);
  const credentialExpired = useMaterialExpiry(credentialDeadline);
  const approvalDeadline = application.approval ? Date.parse(application.approval.expiresAt) : 0;
  const approvalExpired = useMaterialExpiry(approvalDeadline);
  const approved =
    application.currentAction === "ready_to_submit" &&
    application.approval?.packetHash === packet?.packetHash &&
    Number.isFinite(approvalDeadline) &&
    !approvalExpired;
  const materialKey = JSON.stringify(materials);

  useEffect(() => {
    if (approvalExpired) {
      pendingDownload.current?.abort();
      withdrawTransfer();
    }
  }, [approvalExpired, withdrawTransfer]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: changing approval revision cancels the old file without discarding the packet's unchanged previews.
  useEffect(
    () => () => {
      pendingDownload.current?.abort();
      withdrawTransfer();
    },
    [application.revision, withdrawTransfer],
  );

  useEffect(() => {
    mounted.current = true;
    const leave = () => {
      withdrawTransfer();
      pending.current?.abort();
      session.clear();
      setConnected(false);
      setCredentialDeadline(undefined);
      setWorking(false);
      setPreviews([]);
      onUnavailable();
    };
    let channel: BroadcastChannel | undefined;
    try {
      channel = new BroadcastChannel(NATIVE_MATERIAL_SIGN_OUT_CHANNEL);
      channel.onmessage = (event: MessageEvent<unknown>) => {
        if (event.data === "withdraw") leave();
      };
      setCoordinationReady(true);
    } catch {
      setCoordinationReady(false);
      setMessage(
        "This browser cannot coordinate material sign-out. Use a browser with BroadcastChannel support.",
      );
    }
    const signingOut = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const target = new URL(anchor.href);
      if (target.origin === window.location.origin && target.pathname === "/auth/logout") {
        announceNativeMaterialSignOut();
        leave();
      }
    };
    document.addEventListener("click", signingOut, true);
    window.addEventListener("pagehide", leave);
    return () => {
      document.removeEventListener("click", signingOut, true);
      channel?.close();
      window.removeEventListener("pagehide", leave);
      mounted.current = false;
      withdrawTransfer();
      pending.current?.abort();
      session.clear();
      onUnavailable();
    };
  }, [session, onUnavailable, withdrawTransfer]);

  function disconnect() {
    withdrawTransfer();
    pending.current?.abort();
    session.clear();
    setConnected(false);
    setCredentialDeadline(undefined);
    setWorking(false);
    setPreviews([]);
    onUnavailable();
  }

  useEffect(() => {
    if (expired || credentialExpired) {
      withdrawTransfer();
      pending.current?.abort();
      session.clear();
      setConnected(false);
      setCredentialDeadline(undefined);
      setWorking(false);
      setPreviews([]);
      onUnavailable();
    }
  }, [expired, credentialExpired, session, onUnavailable, withdrawTransfer]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the complete material key and packet-keyed parent bind this read; approval revisions preserve the same material.
  useEffect(() => {
    if (!connected || expired || !packet) return;
    const controller = new AbortController();
    pending.current = controller;
    setWorking(true);
    setPreviews([]);
    onUnavailable();
    void Promise.all(
      materials.map(async (material) => {
        const expected =
          material.kind === "tailored_resume"
            ? packet.artifactHashes.resume
            : packet.artifactHashes.coverLetter;
        if (expected !== material.contentSha256) throw Error("MaterialReadUnavailable");
        return readNativeMaterial(
          session,
          {
            applicationId: application.id,
            packetId: packet.id,
            packetHash: packet.packetHash,
            material,
          },
          "preview",
          {
            signal: controller.signal,
            ...(fetchImplementation ? { fetch: fetchImplementation } : {}),
          },
        );
      }),
    )
      .then((values) => {
        if (controller.signal.aborted || !session.ready || Date.now() >= deadline) return;
        setPreviews(values);
        for (const material of materials) onReady(material);
        setMessage("Review each material before approving the application.");
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          session.clear();
          setConnected(false);
          setMessage(nativeMaterialReadFailureCopy(error));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setWorking(false);
        if (pending.current === controller) pending.current = undefined;
      });
    return () => controller.abort();
  }, [connected, expired, materialKey]);

  async function signIn() {
    if (working || busy || expired || !coordinationReady) return;
    setWorking(true);
    setMessage(undefined);
    try {
      await session.signIn();
      if (mounted.current && Date.now() < deadline) {
        setCredentialDeadline(session.expiresAt);
        setConnected(true);
      } else session.clear();
    } catch {
      if (mounted.current)
        setMessage(
          "Sign-in did not finish. Allow the popup and sign in with the same account as this workspace.",
        );
    } finally {
      if (mounted.current) setWorking(false);
    }
  }

  async function sendApprovedFiles(format: "pdf" | "docx") {
    const messenger = nativeExtensionMessenger();
    const approval = application.approval;
    if (
      !packet ||
      !approval ||
      !extensionId ||
      !messenger ||
      busy ||
      working ||
      !session.ready ||
      !approved ||
      Date.now() >= approvalDeadline ||
      Date.now() >= deadline
    )
      return;
    withdrawTransfer();
    const controller = new AbortController();
    pending.current = controller;
    pendingDownload.current = controller;
    setWorking(true);
    setMessage(undefined);
    try {
      const receipt = await transferApprovedNativeMaterials({
        extensionId,
        messenger,
        session,
        binding: {
          applicationId: application.id,
          packetId: packet.id,
          packetHash: packet.packetHash,
          approvalId: approval.id,
          revision: application.revision,
          approvalExpiresAtMs: Date.parse(approval.expiresAt),
          materials,
        },
        format,
        signal: controller.signal,
        isCurrent: () =>
          mounted.current &&
          currentApproval.current.revision === application.revision &&
          currentApproval.current.action === "ready_to_submit",
        ...(fetchImplementation ? { fetch: fetchImplementation } : {}),
      });
      if (controller.signal.aborted || !mounted.current) {
        discardTransferredNativeMaterials(messenger, extensionId, receipt);
        return;
      }
      transferred.current = { messenger, extensionId, receipt };
      setMessage(
        "Approved files reached the selected extension tab. No application has been submitted.",
      );
    } catch {
      if (mounted.current && !controller.signal.aborted)
        setMessage(
          "Files could not be transferred. Select the matching employer tab in the extension and check that its application adapter is available. You can still download your files.",
        );
    } finally {
      if (pending.current === controller) pending.current = undefined;
      if (pendingDownload.current === controller) pendingDownload.current = undefined;
      if (mounted.current) setWorking(false);
    }
  }

  async function download(material: ApplicationTemporaryMaterial, format: "pdf" | "docx") {
    const downloadDeadline = Math.min(deadline, approvalDeadline);
    if (!packet || busy || working || !approved || !session.ready || Date.now() >= downloadDeadline)
      return;
    const controller = new AbortController();
    pending.current = controller;
    pendingDownload.current = controller;
    setWorking(true);
    let bytes: Uint8Array | undefined;
    const clearBytes = () => bytes?.fill(0);
    controller.signal.addEventListener("abort", clearBytes, { once: true });
    let objectUrl: string | undefined;
    try {
      const value = await readNativeMaterial(
        session,
        {
          applicationId: application.id,
          packetId: packet.id,
          packetHash: packet.packetHash,
          material,
        },
        format,
        {
          signal: controller.signal,
          ...(fetchImplementation ? { fetch: fetchImplementation } : {}),
        },
      );
      if (!("contentBase64" in value)) throw Error("MaterialReadUnavailable");
      try {
        bytes = Uint8Array.from(atob(value.contentBase64), (character) => character.charCodeAt(0));
      } finally {
        value.contentBase64 = "";
      }
      const hash = await sha256OfBytes(bytes);
      if (
        controller.signal.aborted ||
        !session.ready ||
        currentApproval.current.revision !== application.revision ||
        currentApproval.current.action !== "ready_to_submit" ||
        Date.now() >= downloadDeadline ||
        bytes.length !== value.sizeBytes ||
        hash !== value.sha256
      )
        throw Error("MaterialReadUnavailable");
      objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: value.mediaType }));
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `${material.kind === "tailored_resume" ? "tailored-resume" : "cover-letter"}.${format}`;
      anchor.click();
      setMessage("Approved material downloaded. Upload it on the employer's application page.");
    } catch {
      if (!controller.signal.aborted)
        setMessage(
          "The material could not be verified and downloaded. Sign in again or prepare a new packet.",
        );
    } finally {
      bytes?.fill(0);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      controller.abort();
      controller.signal.removeEventListener("abort", clearBytes);
      if (pending.current === controller) pending.current = undefined;
      if (pendingDownload.current === controller) pendingDownload.current = undefined;
      if (mounted.current) setWorking(false);
    }
  }

  return (
    <section aria-label="Generated application materials">
      <h3>Review generated materials</h3>
      <p>
        Use the same account as this workspace. Material access uses a separate sign-in held in
        memory for at most ten minutes. Generated materials keep their original 30-minute expiry.
      </p>
      {expired ? (
        <p role="status">These materials expired. Prepare the application again.</p>
      ) : (
        <>
          {!connected ? (
            <button
              type="button"
              disabled={busy || working || !coordinationReady}
              onClick={() => void signIn()}
            >
              {working ? "Signing in..." : "Sign in to view generated materials"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                disconnect();
                setWorking(false);
              }}
            >
              Disconnect material access
            </button>
          )}
          {connected && !credentialExpired
            ? previews.map((preview, index) => (
                <div key={materials[index]?.generationId}>
                  <h4>
                    {materials[index]?.kind === "tailored_resume"
                      ? "Your tailored resume"
                      : "Your cover letter"}
                  </h4>
                  {"sections" in preview
                    ? keyed(
                        preview.sections ?? [],
                        (section) => `${section.kind}:${section.heading}`,
                      ).map(({ item: section, key: sectionKey }) => (
                        <div key={sectionKey}>
                          {section.heading ? <h5>{section.heading}</h5> : null}
                          {keyed(section.entries, (entry) => entry.lines.join("|")).map(
                            ({ item: entry, key: entryKey }) => (
                              <div key={entryKey}>
                                {keyed(entry.lines, (line) => line).map(
                                  ({ item: line, key: lineKey }) => (
                                    <p key={lineKey}>{line}</p>
                                  ),
                                )}
                                <ul>
                                  {keyed(entry.bullets, (bullet) => bullet.text).map(
                                    ({ item: bullet, key: bulletKey }) => (
                                      <li key={bulletKey}>
                                        {bullet.text}{" "}
                                        <strong>
                                          (
                                          {
                                            {
                                              kept: "Kept",
                                              moved_up: "Moved up",
                                              omitted: "Left out for this job",
                                            }[bullet.change]
                                          }
                                          )
                                        </strong>
                                      </li>
                                    ),
                                  )}
                                </ul>
                              </div>
                            ),
                          )}
                        </div>
                      ))
                    : null}
                  {"paragraphs" in preview
                    ? keyed(preview.paragraphs, (paragraph) => paragraph.text).map(
                        ({ item: paragraph, key: paragraphKey }) => (
                          <p key={paragraphKey}>{paragraph.text}</p>
                        ),
                      )
                    : null}
                  {approved
                    ? (["pdf", "docx"] as const).map((format) => (
                        <button
                          key={format}
                          type="button"
                          disabled={busy || working}
                          onClick={() => {
                            const material = materials[index];
                            if (material) void download(material, format);
                          }}
                        >
                          Download{" "}
                          {materials[index]?.kind === "tailored_resume" ? "resume" : "cover letter"}{" "}
                          {format === "pdf" ? "PDF" : "Word (DOCX)"}
                        </button>
                      ))
                    : null}
                </div>
              ))
            : null}
        </>
      )}
      {message && !expired ? <p role="status">{message}</p> : null}
      {!expired && application.currentAction === "ready_to_submit" && approvalExpired ? (
        <p role="status">
          Approval expired. Choose Edit again to review and approve before downloading or sending
          files.
        </p>
      ) : null}
      {extensionId && connected && !expired && approved ? (
        <div>
          <p>Select the matching employer tab in the extension before sending approved files.</p>
          {(["pdf", "docx"] as const).map((format) => (
            <button
              key={format}
              type="button"
              disabled={busy || working || !nativeExtensionMessenger()}
              onClick={() => void sendApprovedFiles(format)}
            >
              Send approved {format === "pdf" ? "PDF" : "Word"} files to extension
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              pendingDownload.current?.abort();
              withdrawTransfer();
              setMessage("Extension file transfer withdrawn.");
            }}
          >
            Withdraw extension file transfer
          </button>
        </div>
      ) : null}
      <p>
        Disconnect clears this page's material access. Files you downloaded and copies you sent to
        an employer are outside platform cleanup.
      </p>
    </section>
  );
}
