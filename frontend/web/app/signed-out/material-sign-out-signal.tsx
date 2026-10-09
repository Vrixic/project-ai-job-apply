"use client";

import { useEffect } from "react";
import { announceNativeMaterialSignOut } from "../../lib/native-material-sign-out-signal";

export function MaterialSignOutSignal() {
  useEffect(announceNativeMaterialSignOut, []);
  return null;
}
