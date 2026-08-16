import {
  adapterVersionPattern,
  type SourceRegistration,
  type SourceRuntimeGate,
  sourceIdentifierPattern,
} from "./contract.js";

const maximumRegisteredSources = 100;

function permittedSyntheticRegistration(registration: Readonly<SourceRegistration>): boolean {
  return (
    registration.sourceId.startsWith("synthetic-") &&
    registration.provider === "other" &&
    registration.provenance === "authorized_fixture"
  );
}

function validateRegistration(registration: SourceRegistration): void {
  if (!sourceIdentifierPattern.test(registration.sourceId)) {
    throw new Error("A canonical source identifier is required");
  }
  if (
    registration.adapter.sourceId !== registration.sourceId ||
    !adapterVersionPattern.test(registration.adapter.adapterVersion)
  ) {
    throw new Error("The adapter descriptor does not match its source registration");
  }
  if (!permittedSyntheticRegistration(registration)) {
    throw new Error("The source is outside the synthetic-only activation policy");
  }
}

export class SourceRegistry {
  readonly #registrations = new Map<string, Readonly<SourceRegistration>>();
  readonly #runtimeGate: SourceRuntimeGate;

  constructor(
    registrations: readonly SourceRegistration[],
    runtimeGate: SourceRuntimeGate = () => true,
  ) {
    this.#runtimeGate = runtimeGate;
    if (registrations.length > maximumRegisteredSources) {
      throw new Error("The source registry exceeds its bounded size");
    }
    for (const registration of registrations) {
      validateRegistration(registration);
      if (this.#registrations.has(registration.sourceId)) {
        throw new Error("Source identifiers must be unique");
      }
      const adapter = Object.freeze({
        sourceId: registration.adapter.sourceId,
        adapterVersion: registration.adapter.adapterVersion,
        poll: registration.adapter.poll.bind(registration.adapter),
      });
      this.#registrations.set(
        registration.sourceId,
        Object.freeze({ ...registration, adapter, enabled: registration.enabled === true }),
      );
    }
  }

  get(sourceId: string): Readonly<SourceRegistration> | undefined {
    return this.#registrations.get(sourceId);
  }

  requireEnabled(sourceId: string): Readonly<SourceRegistration> {
    const registration = this.#registrations.get(sourceId);
    if (!registration?.enabled || !this.#runtimeGate(sourceId)) {
      throw new Error("The ingestion source is disabled");
    }
    return registration;
  }
}
