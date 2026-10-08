import {
  createNativeRouteLifecycle,
  type NativeRouteLifecycleOptions,
} from "./native-route-lifecycle.js";

/** One original cover-letter execution. Its owner must pin the binding/reference and its
 * dispatcher must prevent a second execution from creating the same route. No activation here. */
export function createNativeMaterialRouteLifecycle(options: NativeRouteLifecycleOptions) {
  return createNativeRouteLifecycle("material", options);
}
