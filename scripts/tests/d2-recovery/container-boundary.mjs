import assert from "node:assert/strict";

export const image = "postgres:16.6-alpine";
export const label = "ai-job-apply.synthetic-d2-recovery";

export function assertOwnedContainer(container, expected) {
  assert.match(expected.id, /^[a-f0-9]{64}$/u);
  assert.match(expected.nonce, /^[a-f0-9]{32}$/u);
  assert.equal(expected.name, `d2-recovery-${expected.nonce}`);
  assert.equal(container.Id, expected.id);
  assert.equal(container.Name, `/${expected.name}`);
  assert.equal(container.Config.Image, image);
  assert.equal(container.Config.Labels?.[label], expected.nonce);
  assert.deepEqual(container.HostConfig.Binds ?? [], []);
  assert.deepEqual(Object.keys(container.HostConfig.Tmpfs).sort(), [
    "/d2-recovery",
    "/var/lib/postgresql/data",
  ]);
  assert.ok(container.Mounts.every((mount) => mount.Type === "tmpfs"));
  assert.deepEqual(Object.keys(container.HostConfig.PortBindings), ["5432/tcp"]);
  const [binding, ...extras] = container.HostConfig.PortBindings["5432/tcp"];
  assert.equal(extras.length, 0);
  assert.equal(binding.HostIp, "127.0.0.1");
  return container;
}

export function ownedDatabasePort(container, expected) {
  assertOwnedContainer(container, expected);
  assert.equal(container.State.Running, true);
  const [binding, ...extras] = container.NetworkSettings.Ports["5432/tcp"] ?? [];
  assert.equal(extras.length, 0);
  assert.equal(binding?.HostIp, "127.0.0.1");
  assert.match(binding?.HostPort ?? "", /^[1-9][0-9]{0,4}$/u);
  const port = Number(binding.HostPort);
  assert.ok(port <= 65535);
  return port;
}
