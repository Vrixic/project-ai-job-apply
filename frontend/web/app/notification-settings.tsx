"use client";

import type {
  NotificationDeliveryStatus,
  NotificationPreferences,
} from "@ai-job-apply/api-contracts";
import { useCallback, useEffect, useState } from "react";

type View =
  | { status: "loading" }
  | { status: "absent" }
  | { status: "error" }
  | { status: "ready"; delivery: NotificationDeliveryStatus; preferences: NotificationPreferences };

interface Draft {
  emailEnabled: boolean;
  quietEnabled: boolean;
  start: string;
  end: string;
}

export function minutesToTime(minutes: number): string {
  const hours = String(Math.floor(minutes / 60)).padStart(2, "0");
  return `${hours}:${String(minutes % 60).padStart(2, "0")}`;
}

export function timeToMinutes(value: string): number | undefined {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : undefined;
}

function draftFrom(preferences: NotificationPreferences): Draft {
  return {
    emailEnabled: preferences.emailEnabled,
    quietEnabled: preferences.quietHours.enabled,
    start: minutesToTime(preferences.quietHours.startMinute),
    end: minutesToTime(preferences.quietHours.endMinute),
  };
}

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: () => Promise<unknown> }> {
  const response = await fetch(`/api/platform/notifications${path}`, {
    method,
    cache: "no-store",
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  return { status: response.status, json: () => response.json().catch(() => ({})) };
}

/**
 * Where the candidate hears about new inbox items. The inbox itself is always on and keeps every
 * update; email is an extra, off until the candidate turns it on.
 */
export function NotificationSettings({ authenticated }: { authenticated: boolean }) {
  const [view, setView] = useState<View>({ status: "loading" });
  const [draft, setDraft] = useState<Draft>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  const load = useCallback(async () => {
    try {
      // The account email is the notification address. Recording it can fail (for example when the
      // provider has not verified it); the status below then shows no address.
      await call("PUT", "/delivery/email").catch(() => undefined);
      const [deliveryResponse, preferencesResponse] = await Promise.all([
        call("GET", "/delivery"),
        call("GET", "/preferences"),
      ]);
      if (deliveryResponse.status === 404 || preferencesResponse.status === 404)
        return setView({ status: "absent" });
      if (deliveryResponse.status !== 200 || preferencesResponse.status !== 200)
        return setView({ status: "error" });
      const delivery = (await deliveryResponse.json()) as NotificationDeliveryStatus;
      const preferences = (await preferencesResponse.json()) as NotificationPreferences;
      setView({ status: "ready", delivery, preferences });
      setDraft(draftFrom(preferences));
    } catch {
      setView({ status: "error" });
    }
  }, []);

  useEffect(() => {
    if (authenticated) void load();
  }, [authenticated, load]);

  async function run(action: () => Promise<string | undefined>) {
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await action();
      if (result) setMessage(result);
    } catch {
      setMessage("Something went wrong. Try again shortly.");
    } finally {
      setBusy(false);
    }
  }

  if (!authenticated || view.status === "absent") return null;
  if (view.status === "loading") return <p role="status">Loading notification settings...</p>;
  if (view.status === "error" || !draft) {
    return (
      <section className="notification-settings" aria-labelledby="notification-settings-heading">
        <h2 id="notification-settings-heading">Notifications</h2>
        <p role="alert">
          Notification settings are temporarily unavailable.{" "}
          <button type="button" onClick={() => void load()}>
            Try again
          </button>
        </p>
      </section>
    );
  }

  const { delivery, preferences } = view;
  const email = delivery.email;
  const emailVerified = email?.state === "verified";
  const unchanged = JSON.stringify(draft) === JSON.stringify(draftFrom(preferences));
  const startMinute = timeToMinutes(draft.start);
  const endMinute = timeToMinutes(draft.end);
  const quietInvalid =
    draft.quietEnabled &&
    (startMinute === undefined || endMinute === undefined || startMinute === endMinute);

  const sendTest = () =>
    run(async () => {
      const response = await call("POST", "/delivery/test");
      if (response.status === 429) return "Too many test notifications. Try again in an hour.";
      if (response.status !== 201) return "Could not send a test notification.";
      return "Test sent. It is in your inbox now. If you turned email on, it arrives within about a minute.";
    });

  const save = () =>
    run(async () => {
      const response = await call("PUT", "/preferences", {
        expectedVersion: preferences.version,
        emailEnabled: draft.emailEnabled && emailVerified,
        quietHours: {
          enabled: draft.quietEnabled,
          startMinute: startMinute ?? preferences.quietHours.startMinute,
          endMinute: endMinute ?? preferences.quietHours.endMinute,
          timeZone: draft.quietEnabled ? browserTimeZone() : preferences.quietHours.timeZone,
        },
      });
      await load();
      if (response.status === 409)
        return "These settings changed elsewhere. Review them and save again.";
      return response.status === 200 ? "Saved." : "Could not save. Try again shortly.";
    });

  return (
    <section className="notification-settings" aria-labelledby="notification-settings-heading">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Notifications</span>
          <h2 id="notification-settings-heading">How you hear about updates</h2>
        </div>
      </div>
      <p>
        Your inbox always keeps every update. You can also get an email. It contains no details
        about your applications; it only tells you to open the inbox.
      </p>

      <h3>Email</h3>
      {email?.state === "verified" ? (
        <label>
          <input
            type="checkbox"
            checked={draft.emailEnabled}
            onChange={(event) => setDraft({ ...draft, emailEnabled: event.target.checked })}
          />{" "}
          Email me at <strong>{email.address}</strong> when something new is in my inbox
        </label>
      ) : email?.state === "suppressed" ? (
        <p role="alert">
          We could not deliver to {email.address}, so email notifications are off. Change the email
          address on your account to turn them back on.
        </p>
      ) : (
        <p>
          Email notifications use the email address you signed up with, and we could not confirm it
          yet. Reload this page. If it stays this way, check that your sign-in provider has verified
          the address.
        </p>
      )}

      <h3>Quiet hours</h3>
      <label>
        <input
          type="checkbox"
          checked={draft.quietEnabled}
          onChange={(event) => setDraft({ ...draft, quietEnabled: event.target.checked })}
        />{" "}
        Hold email notifications during these hours
      </label>
      {draft.quietEnabled && (
        <div>
          <label>
            From
            <input
              type="time"
              value={draft.start}
              onChange={(event) => setDraft({ ...draft, start: event.target.value })}
            />
          </label>
          <label>
            Until
            <input
              type="time"
              value={draft.end}
              onChange={(event) => setDraft({ ...draft, end: event.target.value })}
            />
          </label>
          <p>
            Times use your browser&apos;s time zone ({browserTimeZone()}). Items that need attention
            right away still arrive.
          </p>
          {quietInvalid && <p role="alert">Choose two different times.</p>}
        </div>
      )}

      <div className="button-row">
        <button
          type="button"
          disabled={busy || unchanged || quietInvalid}
          onClick={() => void save()}
        >
          Save notification settings
        </button>
        <button type="button" disabled={busy} onClick={() => void sendTest()}>
          Send a test notification
        </button>
      </div>
      <div aria-live="polite">{message && <p role="status">{message}</p>}</div>
    </section>
  );
}
