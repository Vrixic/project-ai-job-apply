export const NATIVE_MATERIAL_SIGN_OUT_CHANNEL = "native-material-sign-out.v1";

/** Ephemeral same-origin withdrawal notice; no identity, credential, content or storage write. */
export function announceNativeMaterialSignOut(): void {
  let channel: BroadcastChannel | undefined;
  try {
    channel = new BroadcastChannel(NATIVE_MATERIAL_SIGN_OUT_CHANNEL);
    channel.postMessage("withdraw");
  } catch {
    // Native material UI refuses to connect when this browser cannot coordinate withdrawal.
  } finally {
    channel?.close();
  }
}
