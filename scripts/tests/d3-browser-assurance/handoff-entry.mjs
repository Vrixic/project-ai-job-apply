// Synthetic Chrome/authentication boundary; production handoff UI, background and HTTP readers.
let listener;
let tab = { id: 7, url: "https://employer.example/jobs/synthetic" };
const local = new Map();
const session = new Map();
const area = (records) => ({
  get: async (key) => ({ [key]: records.get(key) }),
  set: async (values) => {
    for (const [key, value] of Object.entries(values)) records.set(key, value);
  },
  remove: async (key) => {
    records.delete(key);
  },
  setAccessLevel: async () => undefined,
});
globalThis.chrome = {
  scripting: {
    executeScript: async ({ func }) => [
      {
        result: func(
          new DOMParser().parseFromString(
            '<form><label for="auth">Are you legally authorized to work in the United States?</label><select id="auth" name="auth"><option value="private-y">Yes</option><option value="private-n">No</option></select><label>Anything else?<textarea>PRIVATE_INITIAL_TEXT</textarea></label><label>Email<input value="PRIVATE_EMAIL"></label><input type="hidden" value="PRIVATE_TOKEN"></form>',
            "text/html",
          ),
        ),
      },
    ],
  },
  runtime: {
    id: "synthetic-extension",
    getURL: (path) => `chrome-extension://synthetic-extension/${path}`,
    getManifest: () => ({ version: "0.2.0" }),
    onMessage: {
      addListener: (value) => {
        listener = value;
      },
    },
    onStartup: { addListener: () => undefined },
    onInstalled: { addListener: () => undefined },
    sendMessage: (message) =>
      new Promise((resolve) =>
        listener(
          message,
          { id: "synthetic-extension", url: "chrome-extension://synthetic-extension/popup.html" },
          resolve,
        ),
      ),
  },
  storage: {
    local: area(local),
    session: area(session),
    onChanged: { addListener: () => undefined },
  },
  windows: { getLastFocused: async () => ({ id: 11, type: "normal" }) },
  tabs: { query: async () => [tab], get: async () => tab },
  alarms: {
    create: () => undefined,
    clear: async () => true,
    onAlarm: { addListener: () => undefined },
  },
};
globalThis.handoffSyntheticBoundary = {
  navigate: (url) => {
    tab = { ...tab, url };
  },
  storage: () => [...local, ...session],
};
await import("../../../frontend/extension/entrypoints/background.ts");
const { mountApplicationHandoff } = await import(
  "../../../frontend/extension/lib/application-handoff-ui.ts"
);
mountApplicationHandoff();
