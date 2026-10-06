import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import type { NativeEvidenceBinding } from "./native-evidence-binding.js";
import {
  NATIVE_CALLER_CONTEXT_HEADER,
  NATIVE_CALLER_SIGNED_HEADERS,
  NATIVE_CALLER_STS_BODY,
  NATIVE_CALLER_STS_ORIGIN,
  type NativeTaskCallerProof,
  nativeTaskCallerScope,
  nativeTaskCallerUnavailable,
  validateNativeTaskCallerProof,
} from "./native-task-caller-contract.js";
import { nativeTaskCredentials } from "./native-task-credentials.js";

/** Creates one fixed task/recipient's proof with the SDK's actual SigV4 signer. It captures a
 * GetCallerIdentity request without sending it; the private receiver submits it to AWS. No
 * AssumeRole/credential issuance, SQL, content, persistence or proof of physical task liveness. */
export function createNativeTaskCallerClient(options: {
  binding: NativeEvidenceBinding;
  targetArn: string;
  enabled?: () => boolean;
  testCredentials?: { accessKeyId: string; secretAccessKey: string; sessionToken: string };
}) {
  const scope = nativeTaskCallerScope(options.binding, options.targetArn);
  const enabled = options.enabled ?? (() => false);
  const credentials = options.testCredentials ? { ...options.testCredentials } : undefined;
  const relativeUri = process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI;
  const forbiddenCredentialSource = [
    "AWS_CONTAINER_CREDENTIALS_FULL_URI",
    "AWS_CONTAINER_AUTHORIZATION_TOKEN",
    "AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE",
  ].some((key) => process.env[key] !== undefined);
  const taskCredentials = nativeTaskCredentials({
    relativeUri,
    accountId: scope.binding.allocation.clusterArn.split(":")[4] ?? "",
    enabled,
  });
  let active = false;
  return Object.freeze({
    async proof(requestSha256: string): Promise<Readonly<NativeTaskCallerProof>> {
      if (
        active ||
        !enabled() ||
        (credentials && process.env.NODE_ENV !== "test") ||
        (!credentials && forbiddenCredentialSource)
      )
        throw nativeTaskCallerUnavailable();
      const context = scope.digest(requestSha256);
      active = true;
      let captured: NativeTaskCallerProof | undefined;
      const capturedRequest = Error("NativeCallerRequestCaptured");
      const client = new STSClient({
        region: "us-east-2",
        endpoint: NATIVE_CALLER_STS_ORIGIN,
        maxAttempts: 1,
        ignoreConfiguredEndpointUrls: true,
        credentials: credentials ?? taskCredentials,
        requestHandler: {
          async handle(request: {
            method: string;
            protocol: string;
            hostname: string;
            port?: number;
            path: string;
            query?: Record<string, unknown>;
            body?: unknown;
            headers: Record<string, string>;
          }) {
            if (
              request.method !== "POST" ||
              request.protocol !== "https:" ||
              request.hostname !== "sts.us-east-2.amazonaws.com" ||
              (request.port !== undefined && request.port !== 443) ||
              request.path !== "/" ||
              Object.keys(request.query ?? {}).length !== 0 ||
              request.body !== NATIVE_CALLER_STS_BODY
            )
              throw nativeTaskCallerUnavailable();
            const proof: NativeTaskCallerProof = {
              schemaVersion: 1,
              headers: { ...request.headers },
            };
            if (!enabled() || !validateNativeTaskCallerProof(proof, context, Date.now()))
              throw nativeTaskCallerUnavailable();
            captured = proof;
            throw capturedRequest;
          },
        },
      });
      // Strip SDK telemetry before signing, preserving only the fixed STS/body/context fields.
      // This reviewed SDK's signer adds date, temporary security token, payload hash and signature.
      // addRelativeTo accepts a union of middleware stages. This HTTP-only adapter is checked
      // again by the capture handler's complete signed-request validation.
      const middleware = ((next: (args: { request: unknown }) => Promise<unknown>) =>
        async (args: { request: unknown }) => {
          const request = args.request as { headers: Record<string, string> };
          request.headers = Object.fromEntries(
            Object.entries(request.headers).filter(([key]) =>
              ["content-type", "content-length", "host"].includes(key),
            ),
          );
          request.headers[NATIVE_CALLER_CONTEXT_HEADER] = context;
          return next(args);
        }) as unknown as Parameters<STSClient["middlewareStack"]["addRelativeTo"]>[0];
      client.middlewareStack.addRelativeTo(middleware, {
        name: "nativeCallerContext",
        relation: "before",
        toMiddleware: "httpSigningMiddleware",
      });
      try {
        try {
          await client.send(new GetCallerIdentityCommand({}));
        } catch (error) {
          if (error !== capturedRequest) throw error;
        }
        if (
          !enabled() ||
          !captured ||
          !validateNativeTaskCallerProof(captured, context, Date.now())
        )
          throw nativeTaskCallerUnavailable();
        if (Object.keys(captured.headers).length !== NATIVE_CALLER_SIGNED_HEADERS.length + 1)
          throw nativeTaskCallerUnavailable();
        return Object.freeze({ schemaVersion: 1, headers: Object.freeze({ ...captured.headers }) });
      } catch {
        throw nativeTaskCallerUnavailable();
      } finally {
        client.destroy();
        active = false;
      }
    },
  });
}
