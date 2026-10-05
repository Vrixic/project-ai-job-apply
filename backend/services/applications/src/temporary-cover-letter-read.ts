import {
  type ApplicationCoverLetterFile,
  type ApplicationCoverLetterPreview,
  compileComponentValidator,
} from "@ai-job-apply/api-contracts";
import {
  sameTemporaryMaterialReference,
  type TemporaryMaterialReference,
  validateTemporaryMaterialReference,
} from "@ai-job-apply/domain/temporary-material";
import type { ApplicationStorePort } from "./service.js";
import { ApplicationsUnavailableError } from "./service.js";
import { type ApplicationView, StalePacketError } from "./store.js";
import { temporaryMaterialReasons } from "./temporary-material.js";
import { bindTemporaryResponse } from "./temporary-response.js";

export interface TemporaryCoverLetterRead<T> {
  reference: Readonly<TemporaryMaterialReference>;
  value: T;
  /** Live process-local memory lease. Transport adapters must never persist/serialize it. */
  isCurrent(): boolean;
}

/** Only owned availability and reads. No generation, reconstruction, SQL, object or model port. */
export interface ApplicationTemporaryMaterials {
  current(
    ownerUserId: string,
    applicationId: string,
    reference: Readonly<TemporaryMaterialReference>,
  ): Promise<TemporaryMaterialReference | null>;
  coverLetterPreview?(
    ownerUserId: string,
    applicationId: string,
    reference: Readonly<TemporaryMaterialReference>,
  ): Promise<TemporaryCoverLetterRead<ApplicationCoverLetterPreview>>;
  coverLetterFile?(
    ownerUserId: string,
    applicationId: string,
    reference: Readonly<TemporaryMaterialReference>,
    format: "pdf" | "docx",
  ): Promise<TemporaryCoverLetterRead<ApplicationCoverLetterFile>>;
}

const validPreview = compileComponentValidator("ApplicationCoverLetterPreview");
const validFile = compileComponentValidator("ApplicationCoverLetterFile");
type Content = ApplicationCoverLetterPreview | ApplicationCoverLetterFile;

function discard(value: Content): void {
  if ("contentBase64" in value) value.contentBase64 = "";
  if ("paragraphs" in value) {
    for (const paragraph of value.paragraphs) {
      paragraph.text = "";
      paragraph.factIds.length = 0;
    }
    value.paragraphs.length = 0;
  }
}

/** Never hold SQL locks across rendering. Recheck packet, terminal state, owner memory and time
 * after the content read. Returned content is ephemeral and has a transport deadline guard. */
export async function readBoundTemporaryCoverLetter<T extends Content>(input: {
  store: ApplicationStorePort;
  materials: ApplicationTemporaryMaterials | undefined;
  view: ApplicationView;
  reference: TemporaryMaterialReference;
  clock: () => Date;
  format?: "pdf" | "docx";
  read: (
    port: ApplicationTemporaryMaterials,
    reference: Readonly<TemporaryMaterialReference>,
  ) => Promise<TemporaryCoverLetterRead<T>>;
}): Promise<T> {
  const { store, materials, view, clock } = input;
  const reference = Object.freeze(structuredClone(input.reference));
  const { ownerUserId, applicationId } = reference;
  const packetId = view.currentPacket?.id;
  const packetHash = view.currentPacket?.packetHash;
  let result: TemporaryCoverLetterRead<T> | undefined;
  function checkTime(): void {
    const reasons = temporaryMaterialReasons([reference], [reference], clock());
    if (reasons.length) throw new StalePacketError(reasons);
  }
  function checkView(current: ApplicationView): void {
    if (
      current.application.ownerUserId !== ownerUserId ||
      current.application.id !== applicationId ||
      current.application.status === "applied" ||
      current.application.status === "cancelled" ||
      current.currentPacket?.id !== packetId ||
      current.currentPacket?.packetHash !== packetHash ||
      current.currentPacket?.artifactHashes.coverLetter !== reference.contentSha256 ||
      !current.currentPacket?.temporaryMaterials?.some((candidate) =>
        sameTemporaryMaterialReference(reference, candidate),
      )
    )
      throw new StalePacketError(["temporary_material_changed"]);
  }
  async function checkMemory(): Promise<void> {
    if (!materials) throw new ApplicationsUnavailableError();
    const live = await materials.current(ownerUserId, applicationId, { ...reference });
    checkTime();
    if (live === null) throw new StalePacketError(["temporary_material_changed"]);
    if (
      !validateTemporaryMaterialReference(live) ||
      live.ownerUserId !== ownerUserId ||
      live.applicationId !== applicationId
    )
      throw new ApplicationsUnavailableError();
    if (!sameTemporaryMaterialReference(reference, live))
      throw new StalePacketError(["temporary_material_changed"]);
  }
  try {
    checkTime();
    checkView(view);
    await checkMemory();
    if (!materials) throw new ApplicationsUnavailableError();
    checkTime();
    result = await input.read(materials, { ...reference });
    checkTime();
    if (
      typeof result.isCurrent !== "function" ||
      !validateTemporaryMaterialReference(result.reference) ||
      !sameTemporaryMaterialReference(reference, result.reference)
    )
      throw new StalePacketError(["temporary_material_changed"]);
    const value = result.value;
    if (
      "temporaryMaterial" in value ||
      (input.format
        ? !validFile(value) || !("format" in value) || value.format !== input.format
        : !validPreview(value) ||
          !("paragraphs" in value) ||
          value.documentId !== reference.generationId ||
          value.version !== reference.version ||
          !value.matchesPacket) ||
      !("contentSha256" in value) ||
      value.contentSha256 !== reference.contentSha256
    )
      throw new ApplicationsUnavailableError();
    await checkMemory();
    checkView(await store.getApplication(ownerUserId, applicationId));
    checkTime();
    if (!result.isCurrent()) throw new StalePacketError(["temporary_material_changed"]);
    const { ownerUserId: _owner, applicationId: _application, ...metadata } = reference;
    Object.assign(value, { temporaryMaterial: metadata });
    const isCurrent = result.isCurrent;
    bindTemporaryResponse(
      value,
      () => {
        checkTime();
        return isCurrent();
      },
      () => discard(value),
    );
    return value;
  } catch (error) {
    if (result?.value) discard(result.value);
    if (error instanceof StalePacketError || error instanceof ApplicationsUnavailableError)
      throw error;
    throw new ApplicationsUnavailableError();
  }
}
