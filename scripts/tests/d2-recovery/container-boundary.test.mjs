import assert from "node:assert/strict";
import { test } from "node:test";
import { assertOwnedContainer, image, label, ownedDatabasePort } from "./container-boundary.mjs";

const expected = {
  id: "a".repeat(64),
  nonce: "b".repeat(32),
  name: `d2-recovery-${"b".repeat(32)}`,
};
function fixture() {
  return {
    Id: expected.id,
    Name: `/${expected.name}`,
    Config: { Image: image, Labels: { [label]: expected.nonce } },
    HostConfig: {
      Binds: null,
      Tmpfs: { "/d2-recovery": "rw", "/var/lib/postgresql/data": "rw" },
      PortBindings: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "" }] },
    },
    Mounts: [],
    State: { Running: true },
    NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "56543" }] } },
  };
}
test("accepts only the exact nonce-bound disposable container and loopback port", () => {
  assert.equal(assertOwnedContainer(fixture(), expected).Id, expected.id);
  assert.equal(ownedDatabasePort(fixture(), expected), 56543);
});
for (const [name, mutate] of [
  [
    "another ID",
    (value) => {
      value.Id = "c".repeat(64);
    },
  ],
  [
    "another name",
    (value) => {
      value.Name = "/user-database";
    },
  ],
  [
    "another image",
    (value) => {
      value.Config.Image = "postgres:latest";
    },
  ],
  [
    "missing ownership label",
    (value) => {
      delete value.Config.Labels[label];
    },
  ],
  [
    "wrong nonce",
    (value) => {
      value.Config.Labels[label] = "d".repeat(32);
    },
  ],
  [
    "host bind",
    (value) => {
      value.HostConfig.Binds = ["user-data:/var/lib/postgresql/data"];
    },
  ],
  [
    "named volume",
    (value) => {
      value.Mounts = [{ Type: "volume" }];
    },
  ],
  [
    "non-tmpfs dump",
    (value) => {
      delete value.HostConfig.Tmpfs["/d2-recovery"];
    },
  ],
  [
    "extra published port",
    (value) => {
      value.HostConfig.PortBindings["80/tcp"] = [];
    },
  ],
  [
    "public bind",
    (value) => {
      value.HostConfig.PortBindings["5432/tcp"][0].HostIp = "0.0.0.0";
    },
  ],
]) {
  test(`refuses cleanup of ${name}`, () => {
    const value = fixture();
    mutate(value);
    assert.throws(() => assertOwnedContainer(value, expected));
  });
}
for (const [name, mutate] of [
  [
    "stopped database",
    (value) => {
      value.State.Running = false;
    },
  ],
  [
    "non-loopback assigned port",
    (value) => {
      value.NetworkSettings.Ports["5432/tcp"][0].HostIp = "::";
    },
  ],
  [
    "invalid assigned port",
    (value) => {
      value.NetworkSettings.Ports["5432/tcp"][0].HostPort = "65536";
    },
  ],
  [
    "duplicate assigned port",
    (value) => {
      value.NetworkSettings.Ports["5432/tcp"].push({ HostIp: "127.0.0.1", HostPort: "56544" });
    },
  ],
]) {
  test(`refuses connection to ${name}`, () => {
    const value = fixture();
    mutate(value);
    assert.throws(() => ownedDatabasePort(value, expected));
  });
}
