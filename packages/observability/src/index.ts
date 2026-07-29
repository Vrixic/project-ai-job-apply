import { randomUUID } from "node:crypto";
import pino, { type Logger } from "pino";

const REDACTED_PATHS = [
  "req.headers.authorization",
  "request.headers.authorization",
  "accessToken",
  "refreshToken",
  "password",
  "email",
  "*.email",
  "targetRoles",
  "locations",
  "*.targetRoles",
  "*.locations",
  "resume",
  "*.resume",
];

export function createLogger(options: {
  service: string;
  level?: string;
  releaseSha?: string;
}): Logger {
  return pino({
    name: options.service,
    level: options.level ?? "info",
    base: {
      service: options.service,
      release_sha: options.releaseSha ?? "local",
    },
    redact: {
      paths: REDACTED_PATHS,
      censor: "[REDACTED]",
    },
  });
}

export function correlationId(headerValue: string | undefined): string {
  if (headerValue && /^[a-zA-Z0-9._-]{8,128}$/.test(headerValue)) {
    return headerValue;
  }
  return randomUUID();
}
