import { randomBytes } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "../app/server/src/app.js";
import { MemoryStore } from "../app/server/src/store.js";
import type { State } from "../app/server/src/domain.js";
import { assertApprovedReviewState } from "./review-state-guard.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const statePath = resolve(root, ".local/review-state-synthetic.json");

async function main() {
  if ((await lstat(dirname(statePath))).isSymbolicLink() || (await lstat(statePath)).isSymbolicLink())
    throw new Error("Review state must be a local regular file");
  const contents = await readFile(statePath);
  const state = JSON.parse(contents.toString("utf8")) as State;
  assertApprovedReviewState(contents, state);

  const store = new MemoryStore(state);
  const app = await buildApp({
    store,
    secret: randomBytes(48).toString("hex"),
    demo: true,
    origins: ["http://127.0.0.1:5390", "http://localhost:5390"],
    collectorUrl: "/collector",
  });
  await app.listen({ host: "127.0.0.1", port: 3012 });
  console.log("CyP synthetic review API ready on 127.0.0.1:3012");
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => { void app.close().then(() => process.exit(0)); });
}

main().catch(() => {
  console.error(JSON.stringify({ status: "FAILED", code: "REVIEW_API_NOT_STARTED" }));
  process.exitCode = 1;
});
