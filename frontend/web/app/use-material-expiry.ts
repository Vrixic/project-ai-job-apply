"use client";

import { useEffect, useState } from "react";

/** Timers clear idle UI; focus/visibility and action-time checks also cover suspended tabs. */
export function useMaterialExpiry(deadline: number | undefined): boolean {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (deadline === undefined) return;
    const check = () => setNow(Date.now());
    check();
    const timer = window.setTimeout(
      check,
      Math.max(0, Math.min(deadline - Date.now(), 2_147_483_647)),
    );
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [deadline]);
  return deadline !== undefined && Math.max(now, Date.now()) >= deadline;
}
