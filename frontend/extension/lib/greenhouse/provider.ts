import type { ApplicationProvider } from "../providers/types";
import { fillGreenhouseFields } from "./fill";
import {
  greenhouseApplicationIdentity,
  greenhouseChallengePresent,
  inspectGreenhouseApplication,
} from "./inspect";
import { greenhouseExecutionProfile } from "./profiles";

const unavailable = () => Error("GreenhouseExecutionUnavailable");
const ROOT = "form#application_form, form#application-form";

export const greenhouseProvider: ApplicationProvider = {
  id: "greenhouse",
  adapterId: "greenhouse-application-v1",
  variantId: "greenhouse-standard-v1",
  identity: greenhouseApplicationIdentity,
  challengePresent: greenhouseChallengePresent,
  inspect: inspectGreenhouseApplication,
  fill: fillGreenhouseFields,
  root(document) {
    const roots = document.querySelectorAll(ROOT);
    const root = roots[0];
    const view = document.defaultView;
    if (roots.length !== 1 || !view || !(root instanceof view.HTMLFormElement)) throw unavailable();
    return root;
  },
  submitControl(root, profile) {
    const view = root.ownerDocument.defaultView;
    const buttons = root.querySelectorAll(profile.submitSelector);
    const button = buttons[0];
    if (
      !view ||
      buttons.length !== 1 ||
      !(button instanceof view.HTMLButtonElement || button instanceof view.HTMLInputElement) ||
      button.type !== "submit" ||
      button.form !== root
    )
      throw unavailable();
    return button;
  },
  rootValid(root) {
    const view = root.ownerDocument.defaultView;
    return Boolean(view && root instanceof view.HTMLFormElement && root.checkValidity());
  },
  profile: greenhouseExecutionProfile,
};
