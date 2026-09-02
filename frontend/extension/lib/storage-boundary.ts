export interface TrustedStorageArea {
  setAccessLevel(options: { accessLevel: "TRUSTED_CONTEXTS" }): Promise<void>;
}

export async function restrictExtensionStorageToTrustedContexts(storage: {
  local: TrustedStorageArea;
  session: TrustedStorageArea;
}): Promise<void> {
  await Promise.all([
    storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
    storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
  ]);
}
