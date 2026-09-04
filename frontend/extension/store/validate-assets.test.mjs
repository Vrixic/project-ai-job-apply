import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { validateStoreAssets } from "./validate-assets.mjs";

const extensionRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const roots = [];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "extension-store-assets-"));
  roots.push(root);
  const assets = join(root, "store", "assets");
  await mkdir(assets, { recursive: true });
  for (const name of ["edge-logo-300x300.png", "promo-small-440x280.png"]) {
    await copyFile(join(extensionRoot, "store", "assets", name), join(assets, name));
  }
  return { root, assets };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("browser-store asset validation", () => {
  it("accepts only the exact sanitized candidate dimensions", async () => {
    await expect(validateStoreAssets(extensionRoot)).resolves.toMatchObject({
      profile: "d2_store_asset_candidate_v1",
      assetCount: 2,
    });
  });

  it("rejects unexpected files", async () => {
    const { root, assets } = await fixture();
    await writeFile(join(assets, "unreviewed.png"), "not an image");
    await expect(validateStoreAssets(root)).rejects.toThrow("allowlist");
  });

  it("rejects PNG corruption", async () => {
    const { root, assets } = await fixture();
    const path = join(assets, "promo-small-440x280.png");
    const data = await readFile(path);
    data[data.length - 1] ^= 1;
    await writeFile(path, data);
    await expect(validateStoreAssets(root)).rejects.toThrow("checksum");
  });
});
