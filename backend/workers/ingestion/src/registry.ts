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

function permittedAtsRegistration(
  registration: Readonly<SourceRegistration>,
  providerActivationAllowed: boolean,
): boolean {
  const provider = registration.provider;
  return (
    (provider === "greenhouse" || provider === "lever" || provider === "ashby") &&
    registration.sourceId.startsWith(`${provider}-`) &&
    registration.provenance === "permitted_api" &&
    (registration.enabled !== true || providerActivationAllowed)
  );
}

function validateRegistration(
  registration: SourceRegistration,
  providerActivationAllowed: boolean,
): void {
  if (!sourceIdentifierPattern.test(registration.sourceId)) {
    throw new Error("A canonical source identifier is required");
  }
  if (
    registration.adapter.sourceId !== registration.sourceId ||
    !adapterVersionPattern.test(registration.adapter.adapterVersion)
  ) {
    throw new Error("The adapter descriptor does not match its source registration");
  }
  if (
    !permittedSyntheticRegistration(registration) &&
    !permittedAtsRegistration(registration, providerActivationAllowed)
  ) {
    throw new Error("The source is outside the default-off activation policy");
  }
}

export class SourceRegistry {
  readonly #registrations = new Map<string, Readonly<SourceRegistration>>();
  readonly #runtimeGate: SourceRuntimeGate;

  constructor(
    registrations: readonly SourceRegistration[],
    runtimeGate: SourceRuntimeGate = () => true,
    options: Readonly<{ providerActivationAllowed?: boolean }> = {},
  ) {
    this.#runtimeGate = runtimeGate;
    if (registrations.length > maximumRegisteredSources) {
      throw new Error("The source registry exceeds its bounded size");
    }
    for (const registration of registrations) {
      validateRegistration(registration, options.providerActivationAllowed === true);
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
