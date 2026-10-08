import { isMainThread } from "node:worker_threads";

let allocated = false;
/** One content allocation across native material kinds. Never reset or reuse a process. */
export function claimNativeMaterialProcess(): void {
  if (process.platform !== "linux" || !isMainThread || allocated)
    throw Error("NativeMemorySessionUnavailable");
  allocated = true;
}
