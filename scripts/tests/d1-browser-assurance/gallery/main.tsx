import { type ComponentType, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import "../../../../frontend/web/app/styles.css";
import { EntitlementStatus } from "../../../../frontend/web/app/entitlement-status";
import { JobSearchForm } from "../../../../frontend/web/app/job-search-form";
import { SavedJobsPanel } from "../../../../frontend/web/app/saved-jobs-panel";

function CandidateCatalog({ authenticated = true }: { authenticated?: boolean }) {
  return (
    <main>
      <h1>Generated-synthetic D1 candidate assurance</h1>
      <JobSearchForm authenticated={authenticated} />
      <SavedJobsPanel authenticated={authenticated} />
      <EntitlementStatus authenticated={authenticated} />
    </main>
  );
}

type Story = ComponentType<Record<string, unknown>>;
type MountParameters = { story: string; props?: Record<string, unknown> };

const stories = new Map<string, Story>([
  ["d1-candidate-surfaces/CandidateCatalog", CandidateCatalog as Story],
]);

const container = document.querySelector<HTMLDivElement>("#root");
if (!container) throw new Error("The browser-assurance gallery root is missing");

let root: Root | undefined;

declare global {
  interface Window {
    mount(parameters: MountParameters): Promise<void>;
    unmount(): Promise<void>;
  }
}

window.mount = async ({ story, props = {} }) => {
  const StoryComponent = stories.get(story);
  if (!StoryComponent) throw new Error(`Unknown generated-synthetic story: ${story}`);
  root ??= createRoot(container);
  root.render(createElement(StoryComponent, props));
};

window.unmount = async () => {
  root?.unmount();
  root = undefined;
};
