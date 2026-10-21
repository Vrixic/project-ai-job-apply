import { spawn } from "node:child_process";
import { startD3BrowserAssuranceServer } from "./server.mjs";

// Serves the production candidate workspace with synthetic BFF, native and extension responses on
// loopback so the generate-then-apply flow can be tried by hand. No AWS, Docker, Auth0 or employer
// request is involved. Stop with Ctrl+C.
const server = await startD3BrowserAssuranceServer({ indexFile: "playground.html" });
console.log(`Generate-then-apply playground: ${server.origin}/`);
console.log("Synthetic data only. Press Ctrl+C to stop.");
if (process.argv.includes("--open")) {
  const opener =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", `${server.origin}/`]]
      : process.platform === "darwin"
        ? ["open", [`${server.origin}/`]]
        : ["xdg-open", [`${server.origin}/`]];
  spawn(opener[0], opener[1], { stdio: "ignore", detached: true }).unref();
}
const stop = async () => {
  await server.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
