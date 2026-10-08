import {
  createNativeRouteLifecycle,
  type NativeRouteLifecycleOptions,
} from "./native-route-lifecycle.js";

/** Retains the original resume checkpoint names and behavior. */
export function createNativeResumeRouteLifecycle(options: NativeRouteLifecycleOptions) {
  return createNativeRouteLifecycle("resume", options);
}
