import type { ConfigContext, ExpoConfig } from "expo/config";

const AUTH0_CUSTOM_SCHEME = "applydashdev";

export default ({ config }: ConfigContext): ExpoConfig => {
  const domain = process.env.EXPO_PUBLIC_AUTH0_DOMAIN?.trim() ?? "";
  const clientId = process.env.EXPO_PUBLIC_AUTH0_CLIENT_ID?.trim() ?? "";
  const audience = process.env.EXPO_PUBLIC_AUTH0_AUDIENCE?.trim() || "ai-job-apply-api";
  const auth0Configured =
    domain.length > 0 &&
    !domain.includes("://") &&
    !domain.includes("/") &&
    !/\s/.test(domain) &&
    clientId.length > 0 &&
    audience === "ai-job-apply-api";

  return {
    ...config,
    name: "ApplyDash Development",
    slug: "applydash-development",
    version: "0.1.0",
    scheme: AUTH0_CUSTOM_SCHEME,
    orientation: "portrait",
    userInterfaceStyle: "automatic",
    ios: {
      bundleIdentifier: "com.vrix.applydash.dev",
      supportsTablet: true,
    },
    android: {
      package: "com.vrix.applydash.dev",
    },
    plugins: [
      [
        "react-native-auth0",
        {
          customScheme: AUTH0_CUSTOM_SCHEME,
          domain: auth0Configured ? domain : "configuration-required.invalid",
        },
      ],
    ],
    extra: {
      auth0Configured,
    },
  };
};
