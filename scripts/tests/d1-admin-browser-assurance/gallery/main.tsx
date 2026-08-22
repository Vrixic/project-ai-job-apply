import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import "../../../../frontend/admin/app/styles.css";
import { ModerationConsole } from "../../../../frontend/admin/app/moderation-console";

const container = document.querySelector<HTMLDivElement>("#root");
if (!container) throw new Error("The admin browser-assurance root is missing");

let root: Root | undefined;

declare global {
  interface Window {
    mountAdmin(): Promise<void>;
    unmountAdmin(): Promise<void>;
  }
}

window.mountAdmin = async () => {
  root ??= createRoot(container);
  root.render(
    createElement("main", undefined, [
      createElement("p", { className: "eyebrow", key: "eyebrow" }, "Restricted internal console"),
      createElement("h1", { key: "heading" }, "Job and source moderation"),
      createElement(ModerationConsole, { key: "console" }),
    ]),
  );
};

window.unmountAdmin = async () => {
  root?.unmount();
  root = undefined;
};
