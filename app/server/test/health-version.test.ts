import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { MemoryStore } from "../src/store.js";
import { seed } from "../src/seed.js";

// The version published is visible to anyone (28-10-2026: to check that the latest one is the one running).
test("the health check names the version published by Render, and nothing when there is none", async () => {
  const before = process.env.RENDER_GIT_COMMIT;
  const app = await buildApp({ store: new MemoryStore(seed()), secret: "test-only-secret-with-more-than-32-characters", demo: true, origins: [] });
  try {
    delete process.env.RENDER_GIT_COMMIT;
    const local = (await app.inject("/api/health")).json();
    assert.equal(local.status, "ok");
    assert.equal("version" in local, false);
    process.env.RENDER_GIT_COMMIT = "45ea3e8f6b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e";
    const published = await app.inject("/api/health");
    assert.equal(published.statusCode, 200);
    assert.equal(published.json().version, "45ea3e8");
    assert.equal(published.headers["cache-control"], "no-store");
  } finally {
    if (before === undefined) delete process.env.RENDER_GIT_COMMIT; else process.env.RENDER_GIT_COMMIT = before;
    await app.close();
  }
});
