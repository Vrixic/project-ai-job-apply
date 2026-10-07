import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  ChangeResourceRecordSetsCommand,
  GetChangeCommand,
  ListResourceRecordSetsCommand,
  type ResourceRecordSet,
  Route53Client,
} from "@aws-sdk/client-route-53";
import {
  type NativeResumeRouteIntent,
  nativeResumeRouteIntent,
} from "./native-resume-route-policy.js";

type Command = ChangeResourceRecordSetsCommand | GetChangeCommand | ListResourceRecordSetsCommand;
interface Client {
  send(command: Command, options: { abortSignal: AbortSignal }): Promise<unknown>;
}
const unavailable = () => Error("NativeResumeDnsUnavailable");
const changeIdPattern = /^\/change\/[A-Z0-9]{1,128}$/u;
function receipt(value: unknown, expectedId?: string) {
  const info = (value as { ChangeInfo?: { Id?: unknown; Status?: unknown } } | null)?.ChangeInfo;
  if (
    !info ||
    typeof info.Id !== "string" ||
    !changeIdPattern.test(info.Id) ||
    (expectedId !== undefined && info.Id !== expectedId) ||
    (info.Status !== "PENDING" && info.Status !== "INSYNC")
  )
    throw unavailable();
  return Object.freeze({ changeId: info.Id, status: info.Status });
}

/** Private single-route DNS transport. The owner must persist this original intent and claim
 * each mutation durably before calling. No internal retries or recovery inference. An error,
 * timeout or absent listing cannot prove an earlier mutation was not or will not be applied.
 * INSYNC proves Route53 propagation only, not client cache expiry, task life, TLS or auth.
 * This is deliberately not wired into preparation/retirement until owning recovery exists. */
export function createNativeResumeDnsRoute(options: {
  intent: NativeResumeRouteIntent;
  enabled?: () => boolean;
  /** Independently withdraw creation while original record inspection/deletion remains possible. */
  creationEnabled?: () => boolean;
  timeoutMs?: number;
  testClient?: Client;
}) {
  const intent = nativeResumeRouteIntent(options.intent);
  const enabled = options.enabled ?? (() => false);
  const creationEnabled = options.creationEnabled ?? (() => false);
  const timeout = options.timeoutMs ?? 10_000;
  const testClient = options.testClient;
  if (
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > 10_000 ||
    (testClient && process.env.NODE_ENV !== "test")
  )
    throw unavailable();
  const hostname = `${intent.allocationId}.${intent.baseHost}`;
  const name = `${hostname}.`;
  const record = (): ResourceRecordSet => ({
    Name: name,
    Type: "A",
    TTL: 30,
    ResourceRecords: [{ Value: intent.publicIp }],
  });
  const intentSha256 = createHash("sha256")
    .update(JSON.stringify({ protocol: "native-resume-dns.v1", ...intent, ttl: 30 }))
    .digest("hex");
  let active = false;
  async function run<T>(
    create: boolean,
    command: Command,
    decode: (response: unknown) => T,
  ): Promise<T> {
    if (
      active ||
      !enabled() ||
      (create && !creationEnabled()) ||
      (testClient && process.env.NODE_ENV !== "test")
    )
      throw unavailable();
    active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    timer.unref();
    const began = performance.now();
    let owned: Route53Client | undefined;
    const check = () => {
      if (
        !enabled() ||
        (create && !creationEnabled()) ||
        controller.signal.aborted ||
        performance.now() - began >= timeout ||
        (testClient && process.env.NODE_ENV !== "test")
      )
        throw unavailable();
    };
    try {
      check();
      if (!testClient)
        owned = new Route53Client({
          region: "us-east-1",
          endpoint: "https://route53.amazonaws.com",
          maxAttempts: 1,
          ignoreConfiguredEndpointUrls: true,
          logger: {
            debug: () => undefined,
            info: () => undefined,
            warn: () => undefined,
            error: () => undefined,
          },
        });
      const client: Client = testClient ?? (owned as Route53Client);
      const response = await client.send(command, {
        abortSignal: controller.signal,
      });
      check();
      return decode(response);
    } catch {
      throw unavailable();
    } finally {
      clearTimeout(timer);
      owned?.destroy();
      // Do not admit a competing operation while an abort-ignoring SDK request is unsettled.
      active = false;
    }
  }
  function change(action: "CREATE" | "DELETE") {
    return run(
      action === "CREATE",
      new ChangeResourceRecordSetsCommand({
        HostedZoneId: intent.hostedZoneId,
        ChangeBatch: { Changes: [{ Action: action, ResourceRecordSet: record() }] },
      }),
      (response) => receipt(response),
    );
  }
  return Object.freeze({
    intentSha256,
    hostname,
    create: () => change("CREATE"),
    remove: () => change("DELETE"),
    inspect: () =>
      run(
        false,
        new ListResourceRecordSetsCommand({
          HostedZoneId: intent.hostedZoneId,
          StartRecordName: name,
          StartRecordType: "A",
          MaxItems: 1,
        }),
        (response) => {
          const value = response as {
            ResourceRecordSets?: ResourceRecordSet[];
            IsTruncated?: unknown;
          } | null;
          const records = value?.ResourceRecordSets;
          if (
            !Array.isArray(records) ||
            records.length > 1 ||
            typeof value?.IsTruncated !== "boolean" ||
            (records.length === 0 && value.IsTruncated)
          )
            throw unavailable();
          const found = records[0];
          if (!found) return Object.freeze({ kind: "absent" as const });
          if (typeof found.Name !== "string" || typeof found.Type !== "string") throw unavailable();
          // Route53 listing begins at the requested name; a next name is not our record.
          if (found.Name.toLowerCase() !== name) return Object.freeze({ kind: "absent" as const });
          const simple = { ...found, Name: found.Name.toLowerCase() };
          // AWS may explicitly serialize false for a basic, non-multivalue record.
          if (simple.MultiValueAnswer === false) delete simple.MultiValueAnswer;
          if (!isDeepStrictEqual(simple, record())) throw unavailable();
          return Object.freeze({ kind: "present" as const });
        },
      ),
    async status(originalChangeId: string) {
      if (typeof originalChangeId !== "string" || !changeIdPattern.test(originalChangeId))
        throw unavailable();
      return run(false, new GetChangeCommand({ Id: originalChangeId }), (response) =>
        receipt(response, originalChangeId),
      );
    },
  });
}
