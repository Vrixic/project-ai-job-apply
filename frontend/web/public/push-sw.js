// Browser notification handler (ADR-056). The push carries no content on purpose: nothing about
// the candidate or an application ever reaches a push service. This worker shows fixed wording
// and opens the inbox, where the real details live.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  event.waitUntil(
    self.registration.showNotification("You have a new update", {
      body: "Open your inbox to see it.",
      tag: "inbox-update",
      renotify: true,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        if ("navigate" in client) await client.navigate("/inbox");
        return;
      }
      await self.clients.openWindow("/inbox");
    })(),
  );
});
