import type postgres from "postgres";
import { afterAll } from "vitest";
import { defaultFieldDefinitions } from "./field-definitions.js";
import { ApplicationsService, type ApplicationsServiceDependencies } from "./service.js";
import { type ApplicationStoreOptions, PostgresApplicationStore } from "./store.js";

const { createSyntheticPacketProtection } = await import(
  new URL("../../../../scripts/tests/d2-recovery/restricted-packets.mjs", import.meta.url).href
);
const protection = createSyntheticPacketProtection() as {
  options: NonNullable<ApplicationStoreOptions["restrictedPackets"]>;
  destroy(): void;
};
afterAll(() => protection.destroy());

/** Explicit offline authority shared across stores in one isolated integration test module. */
export function createIntegrationApplicationStore(
  client: postgres.Sql,
  clock?: () => Date,
  options?: ApplicationStoreOptions,
): PostgresApplicationStore {
  if (process.env.NODE_ENV !== "test") throw Error("IntegrationPacketAuthorityRequiresTestMode");
  return new PostgresApplicationStore(client, clock, {
    definitions: defaultFieldDefinitions(),
    ...options,
    restrictedPackets: protection.options,
  });
}

export function createIntegrationApplicationsService(options: ApplicationsServiceDependencies) {
  if (!(options.store instanceof PostgresApplicationStore))
    throw Error("ExpectedOwningIntegrationStore");
  return new ApplicationsService({ ...options, restrictedPackets: options.store });
}

export async function createFixtureApplication(
  store: PostgresApplicationStore,
  client: postgres.Sql,
  command: Parameters<PostgresApplicationStore["createApplication"]>[0],
) {
  await client`INSERT INTO identity.users (id) VALUES (${command.ownerUserId}::uuid) ON CONFLICT (id) DO NOTHING`;
  return store.createApplication(command);
}

export async function createFixtureServiceApplication(
  service: ApplicationsService,
  client: postgres.Sql,
  ownerUserId: string,
  canonicalJobId: string,
  idempotencyKey: string,
) {
  await client`INSERT INTO identity.users (id) VALUES (${ownerUserId}::uuid) ON CONFLICT (id) DO NOTHING`;
  return service.create(ownerUserId, canonicalJobId, idempotencyKey);
}
