"use client";

import { useEffect } from "react";
import { installSessionExpiryGuard, SESSION_EXPIRED_SIGN_OUT_PATH } from "../lib/session-expiry";

/** Signs the candidate out when the platform says their session can no longer be used. */
export function SessionExpiryGuard() {
  useEffect(
    () =>
      installSessionExpiryGuard(window, () =>
        window.location.assign(SESSION_EXPIRED_SIGN_OUT_PATH),
      ),
    [],
  );
  return null;
}
