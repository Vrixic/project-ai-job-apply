import { useState } from "react";
import { ActivityIndicator, Button, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { Auth0Provider, useAuth0 } from "react-native-auth0";
import { AUTH0_CUSTOM_SCHEME, mobilePublicConfiguration } from "./lib/config";
import { sanitizedAuthMessage } from "./lib/errors";

const publicConfiguration = mobilePublicConfiguration({
  EXPO_PUBLIC_AUTH0_AUDIENCE: process.env.EXPO_PUBLIC_AUTH0_AUDIENCE,
  EXPO_PUBLIC_AUTH0_CLIENT_ID: process.env.EXPO_PUBLIC_AUTH0_CLIENT_ID,
  EXPO_PUBLIC_AUTH0_DOMAIN: process.env.EXPO_PUBLIC_AUTH0_DOMAIN,
});

function ConformanceScreen() {
  const { authorize, clearSession, getCredentials, hasValidCredentials, isLoading, user } =
    useAuth0();
  const [message, setMessage] = useState("Ready for Native Application conformance.");
  const [working, setWorking] = useState(false);

  async function login() {
    setWorking(true);
    try {
      await authorize(
        {
          audience: publicConfiguration.audience,
          scope: "openid profile email offline_access profile:read profile:write",
        },
        {
          customScheme: AUTH0_CUSTOM_SCHEME,
        },
      );
      setMessage("Login completed. Credentials are held by secure native storage.");
    } catch (error) {
      setMessage(sanitizedAuthMessage(error, "login"));
    } finally {
      setWorking(false);
    }
  }

  async function verifyAndRenew() {
    setWorking(true);
    try {
      const valid = await hasValidCredentials();
      if (!valid) {
        setMessage("No valid local session is available.");
        return;
      }
      await getCredentials();
      setMessage("A valid access token is available; renewal occurs automatically when required.");
    } catch (error) {
      setMessage(sanitizedAuthMessage(error, "refresh"));
    } finally {
      setWorking(false);
    }
  }

  async function logout() {
    setWorking(true);
    try {
      await clearSession({}, { customScheme: AUTH0_CUSTOM_SCHEME });
      setMessage("Browser and local application sessions were cleared.");
    } catch (error) {
      setMessage(sanitizedAuthMessage(error, "logout"));
    } finally {
      setWorking(false);
    }
  }

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator />
        <Text>Restoring the local authentication state…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.eyebrow}>Phase 0 identity conformance</Text>
      <Text style={styles.title}>ApplyDash mobile authentication</Text>
      <Text style={styles.body}>
        This development shell records only pass/fail state. It does not display tokens, claims, or
        candidate identity.
      </Text>
      <View style={styles.status}>
        <Text accessibilityLiveRegion="polite">{user ? "Signed in" : "Signed out"}</Text>
        <Text accessibilityLiveRegion="polite">{message}</Text>
      </View>
      {working ? (
        <ActivityIndicator />
      ) : user ? (
        <View style={styles.actions}>
          <Button title="Verify or renew session" onPress={verifyAndRenew} />
          <Button title="Log out" onPress={logout} color="#a52a2a" />
        </View>
      ) : (
        <Button title="Log in with Auth0" onPress={login} />
      )}
    </SafeAreaView>
  );
}

export default function App() {
  if (!publicConfiguration.configured) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.title}>Authentication is not configured</Text>
        <Text style={styles.body}>
          Supply the public development Native Application domain, client ID, and exact platform API
          audience. No client secret belongs in a mobile application.
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <Auth0Provider domain={publicConfiguration.domain} clientId={publicConfiguration.clientId}>
      <ConformanceScreen />
    </Auth0Provider>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: 12,
    width: "100%",
  },
  body: {
    color: "#343a40",
    fontSize: 16,
    lineHeight: 24,
  },
  container: {
    alignItems: "flex-start",
    backgroundColor: "#f8f9fa",
    flex: 1,
    gap: 18,
    justifyContent: "center",
    padding: 28,
  },
  eyebrow: {
    color: "#5c6370",
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  status: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    gap: 8,
    padding: 18,
    width: "100%",
  },
  title: {
    color: "#17191c",
    fontSize: 28,
    fontWeight: "700",
  },
});
