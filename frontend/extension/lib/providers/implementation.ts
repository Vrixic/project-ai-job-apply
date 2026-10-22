declare const __APPLICATION_IMPLEMENTATION_SHA256__: string | undefined;

/** The build binds the registry evidence to the exact provider code it was built from. */
export const applicationImplementationSha256 =
  typeof __APPLICATION_IMPLEMENTATION_SHA256__ === "string" &&
  /^[a-f0-9]{64}$/u.test(__APPLICATION_IMPLEMENTATION_SHA256__)
    ? __APPLICATION_IMPLEMENTATION_SHA256__
    : "0".repeat(64);
