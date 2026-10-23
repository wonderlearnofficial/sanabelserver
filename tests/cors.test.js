const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const cors = require("cors");

const {
  DEVELOPMENT_WEB_ORIGINS,
  NATIVE_APP_ORIGINS,
  buildAllowedOrigins,
  createCorsOptions,
  isOriginAllowed,
} = require("../dist/config/cors");

const production = {
  NODE_ENV: "production",
  CORS_ORIGINS:
    " https://ADMIN.Example.com/, https://sanabel-preview-abc.vercel.app,https://ADMIN.Example.com,not-an-origin,https://example.com/path,custom://origin ",
};

const startProbeServer = async (environment) => {
  const app = express();
  app.use(cors(createCorsOptions(environment)));
  app.all("/probe", (_req, res) => res.status(200).json({ ok: true }));
  app.use((error, _req, res, _next) => {
    res.status(error.status || 500).json({ message: error.message });
  });

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
};

test("production CORS allowlist contains only native and exact configured origins", () => {
  const allowed = buildAllowedOrigins(production);

  assert.equal(allowed.has("https://admin.example.com"), true);
  assert.equal(allowed.has("https://sanabel-preview-abc.vercel.app"), true);
  assert.equal(allowed.has("https://ADMIN.Example.com/"), false);
  assert.equal(allowed.has("not-an-origin"), false);
  assert.equal(allowed.has("https://example.com/path"), false);
  assert.equal(allowed.has("custom://origin"), false);
  assert.equal(allowed.size, NATIVE_APP_ORIGINS.length + 2);
  for (const origin of DEVELOPMENT_WEB_ORIGINS) {
    assert.equal(allowed.has(origin), false);
  }
});

test("development CORS allows known local ports but remains fail-closed", () => {
  const development = { NODE_ENV: "development", CORS_ORIGINS: "" };

  for (const origin of DEVELOPMENT_WEB_ORIGINS) {
    assert.equal(isOriginAllowed(origin, development), true);
  }
  assert.equal(isOriginAllowed("http://localhost:9999", development), false);
  assert.equal(isOriginAllowed("https://attacker.example", development), false);
});

test("production CORS allows native/no-Origin calls and rejects suffix lookalikes", () => {
  for (const origin of NATIVE_APP_ORIGINS) {
    assert.equal(isOriginAllowed(origin, production), true);
  }
  assert.equal(isOriginAllowed(undefined, production), true);
  assert.equal(isOriginAllowed("https://attacker.vercel.app", production), false);
  assert.equal(isOriginAllowed("https://attacker.up.railway.app", production), false);
  assert.equal(
    isOriginAllowed("https://sanabel-preview-abc.vercel.app.attacker.example", production),
    false,
  );
});

// The standalone admin console is a separate web origin from the mobile
// client, so it needs its own entry on both sides of the deployment.
test("standalone admin console origin: dev port allowed, production must be listed", () => {
  const development = { NODE_ENV: "development", CORS_ORIGINS: "" };
  // `admin/vite.config.ts` serves on 5174.
  assert.equal(isOriginAllowed("http://localhost:5174", development), true);
  assert.equal(isOriginAllowed("http://127.0.0.1:5174", development), true);

  // In production nothing is implicit. Wildcard *.vercel.app matching was
  // removed, so an unlisted admin deployment is refused rather than trusted.
  const withoutAdmin = { NODE_ENV: "production", CORS_ORIGINS: "https://sanabel.wonderlearn.net" };
  assert.equal(isOriginAllowed("https://admin.wonderlearn.net", withoutAdmin), false);
  assert.equal(isOriginAllowed("http://localhost:5174", withoutAdmin), false);

  const withAdmin = {
    NODE_ENV: "production",
    CORS_ORIGINS: "https://sanabel.wonderlearn.net,https://admin.wonderlearn.net",
  };
  assert.equal(isOriginAllowed("https://admin.wonderlearn.net", withAdmin), true);
  assert.equal(isOriginAllowed("https://sanabel.wonderlearn.net", withAdmin), true);
});

test("allowed CORS requests and preflights reflect only the approved origin", async () => {
  const server = await startProbeServer(production);
  const origin = "https://admin.example.com";

  try {
    const response = await fetch(`${server.baseUrl}/probe`, {
      headers: { Origin: origin },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), origin);

    const preflight = await fetch(`${server.baseUrl}/probe`, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
    assert.match(
      preflight.headers.get("access-control-allow-headers") || "",
      /authorization/i,
    );
    assert.equal(preflight.headers.get("access-control-max-age"), "86400");
  } finally {
    await server.close();
  }
});

test("disallowed CORS requests and preflights stop with 403 and no allow header", async () => {
  const server = await startProbeServer(production);
  const origin = "https://attacker.vercel.app";

  try {
    for (const method of ["GET", "OPTIONS"]) {
      const response = await fetch(`${server.baseUrl}/probe`, {
        method,
        headers:
          method === "OPTIONS"
            ? {
                Origin: origin,
                "Access-Control-Request-Method": "POST",
              }
            : { Origin: origin },
      });
      assert.equal(response.status, 403);
      assert.equal(response.headers.get("access-control-allow-origin"), null);
      assert.deepEqual(await response.json(), {
        message: "Origin not allowed by CORS",
      });
    }
  } finally {
    await server.close();
  }
});
