"use client";

import type {
  NotificationDeliveryStatus,
  NotificationPreferences,
} from "@ai-job-apply/api-contracts";
import { useCallback, useEffect, useState } from "react";
import {
  browserNotificationsBlocked,
  pushSupported,
  readStoredSubscriptionId,
  storeSubscriptionId,
  subscribeThisBrowser,
  unsubscribeThisBrowser,
} from "../lib/browser-push";

type View =
  | { status: "loading" }
  | { status: "absent" }
  | { status: "error" }
  | { status: "ready"; delivery: NotificationDeliveryStatus; preferences: NotificationPreferences };

interface Draft {
  emailEnabled: boolean;
  pushEnabled: boolean;
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
    pushEnabled: preferences.pushEnabled,
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
 * update; email and browser notifications are extras, off until the candidate turns them on.
 */
export function NotificationSettings({ authenticated }: { authenticated: boolean }) {
  const [view, setView] = useState<View>({ status: "loading" });
  const [draft, setDraft] = useState<Draft>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [thisBrowserId, setThisBrowserId] = useState<string>();

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
      const stored = readStoredSubscriptionId();
      setThisBrowserId(
        stored && delivery.pushSubscriptions.some((s) => s.id === stored && s.state === "active")
          ? stored
          : undefined,
      );
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
  const activeSubscriptions = delivery.pushSubscriptions.filter((s) => s.state === "active");
  const canPush = pushSupported() && delivery.pushPublicKey !== undefined;
  const unchanged = JSON.stringify(draft) === JSON.stringify(draftFrom(preferences));
  const startMinute = timeToMinutes(draft.start);
  const endMinute = timeToMinutes(draft.end);
  const quietInvalid =
    draft.quietEnabled &&
    (startMinute === undefined || endMinute === undefined || startMinute === endMinute);

  const turnOnBrowser = () =>
    run(async () => {
      if (!delivery.pushPublicKey) return "Browser notifications are not available yet.";
      const result = await subscribeThisBrowser(delivery.pushPublicKey);
      if (result.outcome === "denied")
        return "Your browser blocked notifications. Allow them for this site in its settings, then try again.";
      if (result.outcome === "unsupported") return "This browser cannot show notifications.";
      if (result.outcome === "failed") return "Could not turn on browser notifications.";
      const response = await call("POST", "/delivery/push-subscriptions", {
        endpoint: result.endpoint,
      });
      if (response.status === 409)
        return "This account already has the maximum number of browsers. Turn one off first.";
      if (response.status !== 201) return "Could not turn on browser notifications.";
      const body = (await response.json()) as { id?: string };
      if (body.id) storeSubscriptionId(body.id);
      await load();
      return "Browser notifications are on for this browser.";
    });

  const turnOffBrowser = (id: string) =>
    run(async () => {
      await call("DELETE", `/delivery/push-subscriptions/${id}`);
      if (id === thisBrowserId) {
        await unsubscribeThisBrowser();
        storeSubscriptionId(undefined);
      }
      await load();
      return "Browser notifications are off for that browser.";
    });

  const sendTest = () =>
    run(async () => {
      const response = await call("POST", "/delivery/test");
      if (response.status === 429) return "Too many test notifications. Try again in an hour.";
      if (response.status !== 201) return "Could not send a test notification.";
      return "Test sent. It is in your inbox now. Email and browser notifications you turned on arrive within about a minute.";
    });

  const save = () =>
    run(async () => {
      const response = await call("PUT", "/preferences", {
        expectedVersion: preferences.version,
        emailEnabled: draft.emailEnabled && emailVerified,
        pushEnabled: draft.pushEnabled && activeSubscriptions.length > 0,
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
        Your inbox always keeps every update. You can also get an email or a browser notification.
        Neither one contains details about your applications; they only tell you to open the inbox.
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
          Email notifications use the email address you signed up with. That address is not verified
          yet. Verify it with your sign-in provider, then reload this page.
        </p>
      )}

      <h3>Browser notifications</h3>
      {!canPush ? (
        <p>
          {pushSupported()
            ? "Browser notifications are not available yet."
            : "This browser cannot show notifications."}
        </p>
      ) : (
        <div>
          {browserNotificationsBlocked() && (
            <p role="alert">
              This browser is blocking notifications for this site. Allow them in the browser
              settings to turn them on.
            </p>
          )}
          <p>
            {activeSubscriptions.length === 0
              ? "No browser is set up yet."
              : `${activeSubscriptions.length} browser${activeSubscriptions.length === 1 ? "" : "s"} set up.`}
          </p>
          {thisBrowserId ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void turnOffBrowser(thisBrowserId)}
            >
              Turn off for this browser
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => void turnOnBrowser()}>
              Turn on for this browser
            </button>
          )}
          <label>
            <input
              type="checkbox"
              disabled={activeSubscriptions.length === 0}
              checked={draft.pushEnabled && activeSubscriptions.length > 0}
              onChange={(event) => setDraft({ ...draft, pushEnabled: event.target.checked })}
            />{" "}
            Notify my browsers when something new is in my inbox
          </label>
        </div>
      )}

      <h3>Quiet hours</h3>
      <label>
        <input
          type="checkbox"
          checked={draft.quietEnabled}
          onChange={(event) => setDraft({ ...draft, quietEnabled: event.target.checked })}
        />{" "}
        Hold email and browser notifications during these hours
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
