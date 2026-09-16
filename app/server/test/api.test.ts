import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app.js";
import {
  businessDate,
  closeDay,
  postMovement,
  preview,
  type User,
} from "../src/domain.js";
import { seed } from "../src/seed.js";
import { FileStore, MemoryStore, PostgresStore } from "../src/store.js";
const admin: User = { id: "admin", name: "Admin", role: "admin" },
  collector: User = {
    id: "collector",
    name: "Ana",
    role: "collector",
    collectorId: "col-1",
  };
async function setup(store = new MemoryStore(seed())) {
  const app = await buildApp({
    store,
    secret: "test-only-secret-32-characters-long!",
    demo: true,
    origins: ["http://localhost:5173"],
    collectorUrl: "http://localhost:5174",
  });
  const login = async (email: string) =>
    (
      await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email, password: "Demo-CyP-2026!" },
      })
    ).json().token as string;
  const adminToken = await login("admin@cyp.local"),
    collectorToken = await login("collector@cyp.local");
  const post = (
    path: string,
    body: unknown,
    token = adminToken,
    key = randomUUID(),
  ) =>
    app.inject({
      method: "POST",
      url: path,
      payload: body,
      headers: { authorization: `Bearer ${token}`, "idempotency-key": key },
    });
  return { app, post, adminToken, collectorToken, store };
}
test("protected API, invalid credentials and collector scope", async () => {
  const { app, collectorToken } = await setup();
  try {
    assert.equal((await app.inject("/api/snapshot")).statusCode, 401);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: { email: "admin@cyp.local", password: "wrong" },
        })
      ).statusCode,
      401,
    );
    const snap = (
      await app.inject({
        url: "/api/snapshot",
        headers: { authorization: `Bearer ${collectorToken}` },
      })
    ).json();
    assert.equal(snap.collectors.length, 1);
    assert.equal(snap.clients.length, 4);
    assert.ok(snap.movements.every((m: any) => m.collectorId === "col-1"));
  } finally {
    await app.close();
  }
});
test("demo tokens are rejected after switching to configured mode with the same signing secret", async () => {
  const { app, adminToken } = await setup();
  const configured = await buildApp({
    store: new MemoryStore(seed()),
    secret: "test-only-secret-32-characters-long!",
    demo: false,
    origins: [],
    collectorUrl: "http://127.0.0.1:5174",
    adminEmail: "owner@example.com",
    adminPassword: "unique-password-2026",
  });
  try {
    assert.equal(
      (
        await configured.inject({
          url: "/api/snapshot",
          headers: { authorization: `Bearer ${adminToken}` },
        })
      ).statusCode,
      401,
    );
  } finally {
    await app.close();
    await configured.close();
  }
});
test("partial collections update status, idempotent replay applies once, key conflict rejected", async () => {
  const { app, post, collectorToken, store } = await setup();
  try {
    const key = randomUUID();
    const first = await post(
      "/api/cobros",
      { chargeId: "chg-1", amount: 10000 },
      collectorToken,
      key,
    );
    assert.equal(first.statusCode, 200);
    const retry = await post(
      "/api/cobros",
      { chargeId: "chg-1", amount: 10000 },
      collectorToken,
      key,
    );
    assert.deepEqual(retry.json(), first.json());
    assert.equal((await store.read()).charges[0].collected, 10000);
    assert.equal((await store.read()).charges[0].status, "partial");
    assert.equal(
      (
        await post(
          "/api/cobros",
          { chargeId: "chg-1", amount: 20000 },
          collectorToken,
          key,
        )
      ).statusCode,
      409,
    );
  } finally {
    await app.close();
  }
});
test("concurrent overpayment is serialized and cannot overspend a charge", async () => {
  const { app, post, collectorToken, store } = await setup();
  try {
    const results = await Promise.all([
      post(
        "/api/cobros",
        { chargeId: "chg-1", amount: 300000 },
        collectorToken,
      ),
      post(
        "/api/cobros",
        { chargeId: "chg-1", amount: 300000 },
        collectorToken,
      ),
    ]);
    assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 422]);
    assert.equal((await store.read()).charges[0].collected, 300000);
  } finally {
    await app.close();
  }
});
test("idempotency response remains unchanged after the created charge is collected", async () => {
  const { app, post, collectorToken } = await setup();
  try {
    const key = randomUUID(),
      body = {
        clientId: "cli-1",
        service: "Test",
        amount: 10000,
        dueDate: businessDate(),
        required: false,
      };
    const created = await post("/api/cargos", body, undefined, key);
    assert.equal(created.statusCode, 200);
    assert.equal(
      (
        await post(
          "/api/cobros",
          { chargeId: created.json().id, amount: 100 },
          collectorToken,
        )
      ).statusCode,
      200,
    );
    const replay = await post("/api/cargos", body, undefined, key);
    assert.deepEqual(replay.json(), created.json());
  } finally {
    await app.close();
  }
});
test("limits, negative/decimal money, unauthorized route and insufficient office funds are rejected", async () => {
  const { app, post, collectorToken, store } = await setup();
  try {
    for (const amount of [-1, 0, 1.25])
      assert.equal(
        (
          await post(
            "/api/cobros",
            { chargeId: "chg-1", amount },
            collectorToken,
          )
        ).statusCode,
        400,
      );
    assert.equal(
      (
        await post(
          "/api/cobros",
          { chargeId: "chg-5", amount: 100 },
          collectorToken,
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await post(
          "/api/depositos",
          { collectorId: "col-1", amount: 100 },
          collectorToken,
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (await post("/api/depositos", { collectorId: "col-1", amount: 100 }))
        .statusCode,
      409,
    );
    await store.transaction((s) => {
      s.collectors[0].collectionLimit = 10000;
    });
    assert.equal(
      (
        await post(
          "/api/cobros",
          { chargeId: "chg-1", amount: 10001 },
          collectorToken,
        )
      ).json().error.code,
      "COLLECTION_LIMIT",
    );
    assert.equal(
      (
        await post("/api/entregas", { collectorId: "col-1", amount: 900000 })
      ).json().error.code,
      "PAYOUT_LIMIT",
    );
    await store.transaction((s) => {
      s.payouts[0].amount = 300000;
    });
    assert.equal(
      (
        await post(
          "/api/pagos",
          { payoutId: "pay-1", amount: 250000 },
          collectorToken,
        )
      ).json().error.code,
      "INSUFFICIENT_PAYOUT_CASH",
    );
  } finally {
    await app.close();
  }
});
test("exact-zero closure derives ledger values and blocks further movement", async () => {
  const { app, post, collectorToken, store } = await setup();
  try {
    assert.equal(
      (
        await post("/api/cuadres", {
          collectorId: "col-1",
          date: businessDate(),
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await post(
          "/api/cobros",
          { chargeId: "chg-1", amount: 450000 },
          collectorToken,
        )
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await post(
          "/api/pagos",
          { payoutId: "pay-1", amount: 200000 },
          collectorToken,
        )
      ).statusCode,
      200,
    );
    assert.equal(
      (await post("/api/depositos", { collectorId: "col-1", amount: 450000 }))
        .statusCode,
      200,
    );
    assert.equal(preview(await store.read(), "col-1").difference, 0);
    const result = await post("/api/cuadres", {
      collectorId: "col-1",
      date: businessDate(),
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.json().difference, 0);
    assert.equal(
      (
        await post(
          "/api/cobros",
          { chargeId: "chg-2", amount: 1 },
          collectorToken,
        )
      ).json().error.code,
      "DAY_CLOSED",
    );
  } finally {
    await app.close();
  }
});
test("batch failure is atomic; duplicates rejected; collector cannot create charges", async () => {
  const { app, post, collectorToken, store } = await setup();
  try {
    const b = {
      service: "Semanal",
      amount: 1000,
      dueDate: businessDate(),
      required: true,
    };
    assert.equal(
      (
        await post("/api/cargos/recurrentes", {
          ...b,
          clientIds: ["cli-1", "missing"],
        })
      ).statusCode,
      404,
    );
    assert.equal((await store.read()).charges.length, 8);
    assert.equal(
      (
        await post("/api/cargos/recurrentes", {
          ...b,
          clientIds: ["cli-1", "cli-1"],
        })
      ).statusCode,
      422,
    );
    assert.equal(
      (await post("/api/cargos", { ...b, clientId: "cli-1" }, collectorToken))
        .statusCode,
      403,
    );
    assert.equal(
      (
        await post("/api/cargos/recurrentes", {
          ...b,
          clientIds: ["cli-1", "cli-2"],
        })
      ).json().count,
      2,
    );
  } finally {
    await app.close();
  }
});
test("receipt token privacy, ESC/POS bytes and revocation", async () => {
  const { app, post, collectorToken, adminToken } = await setup();
  try {
    const r = (
      await post(
        "/api/cobros",
        { chargeId: "chg-1", amount: 1000 },
        collectorToken,
      )
    ).json();
    const token = r.receipt.token;
    const receipt = await app.inject(`/api/recibos/${token}`);
    assert.equal(receipt.statusCode, 200);
    assert.equal(receipt.json().amount, 1000);
    assert.equal(receipt.json().phone, undefined);
    assert.equal(receipt.headers["cache-control"], "no-store");
    const binary = await app.inject(`/api/recibos/${token}/escpos?width=58`);
    assert.equal(binary.statusCode, 200);
    assert.equal(binary.rawPayload[0], 27);
    assert.equal(binary.rawPayload[1], 64);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/api/recibos/${token}/revocar`,
          headers: { authorization: `Bearer ${adminToken}` },
        })
      ).statusCode,
      200,
    );
    assert.equal((await app.inject(`/api/recibos/${token}`)).statusCode, 404);
  } finally {
    await app.close();
  }
});
test("closed dates/future dates and Dominican midnight boundary", () => {
  assert.equal(businessDate(new Date("2026-09-16T03:59:59Z")), "2026-09-15");
  assert.equal(businessDate(new Date("2026-09-16T04:00:00Z")), "2026-09-16");
  const s = seed();
  assert.throws(() => closeDay(s, admin, "col-1", "2099-01-01"), /futura/);
  s.movements = [];
  closeDay(s, admin, "col-1", "2026-01-01", new Date("2026-01-01T12:00:00Z"));
  assert.throws(
    () =>
      postMovement(
        s,
        collector,
        "collection",
        { chargeId: "chg-1", amount: 1 },
        new Date("2026-01-01T12:01:00Z"),
      ),
    /cerrada/,
  );
});
test("file adapter persists and failed transactions never leak changes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cyp-test-")),
    path = join(dir, "state.json"),
    store = await FileStore.open(path, seed());
  await assert.rejects(
    store.transaction((s) => {
      s.charges[0].collected = 900;
      throw new Error("rollback");
    }),
  );
  assert.equal((await store.read()).charges[0].collected, 0);
  await store.transaction((s) => {
    s.collectors[0].lat = 19;
  });
  await store.close();
  const reopened = await FileStore.open(path, seed());
  assert.equal((await reopened.read()).collectors[0].lat, 19);
  assert.ok((await readFile(path, "utf8")).includes("Colmado"));
  await reopened.close();
});
test("OpenAPI includes typed financial requests and bearer security", async () => {
  const { app } = await setup();
  try {
    const spec = (await app.inject("/api/openapi.json")).json();
    assert.equal(spec.openapi, "3.1.0");
    assert.equal(
      spec.paths["/api/cobros"].post.requestBody.content["application/json"]
        .schema.properties.amount.type,
      "integer",
    );
    assert.ok(
      spec.paths["/api/cuadres/preview"].get.parameters.some(
        (p: any) => p.name === "date",
      ),
    );
  } finally {
    await app.close();
  }
});
test(
  "native PostgreSQL store integration",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const store = new PostgresStore(process.env.TEST_DATABASE_URL!);
    await store.transaction((s) => {
      if (s.collectors.length === 0) Object.assign(s, seed());
    });
    const { app, post, collectorToken } = await setup(store as MemoryStore);
    try {
      const key = randomUUID();
      const results = await Promise.all([
        post(
          "/api/cobros",
          { chargeId: "chg-1", amount: 100 },
          collectorToken,
          key,
        ),
        post(
          "/api/cobros",
          { chargeId: "chg-1", amount: 100 },
          collectorToken,
          key,
        ),
      ]);
      assert.ok(results.every((r) => r.statusCode === 200));
      assert.equal(
        results[0].json().movement.id,
        results[1].json().movement.id,
      );
    } finally {
      await app.close();
    }
  },
);
