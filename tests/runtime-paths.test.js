import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { resolveRuntimePaths } from "../src/runtime-paths.js";

test("resolveRuntimePaths defaults to the omnichannel database in cwd data", () => {
  assert.deepEqual(
    resolveRuntimePaths({ cwd: "/service", env: {} }),
    {
      dataDir: "/service/data",
      databasePath: "/service/data/dclaw-omnichannel-service.sqlite"
    }
  );
});

test("resolveRuntimePaths resolves a relative DATA_DIR from cwd", () => {
  assert.deepEqual(
    resolveRuntimePaths({ cwd: "/service", env: { DATA_DIR: "runtime/db" } }),
    {
      dataDir: "/service/runtime/db",
      databasePath: "/service/runtime/db/dclaw-omnichannel-service.sqlite"
    }
  );
});

test("resolveRuntimePaths makes a relative DATABASE_PATH authoritative", () => {
  assert.deepEqual(
    resolveRuntimePaths({ cwd: "/service", env: { DATABASE_PATH: "state/app.sqlite" } }),
    {
      dataDir: "/service/state",
      databasePath: "/service/state/app.sqlite"
    }
  );
});

test("resolveRuntimePaths preserves an absolute DATABASE_PATH", () => {
  assert.deepEqual(
    resolveRuntimePaths({
      cwd: "/service",
      env: { DATA_DIR: "ignored", DATABASE_PATH: "/var/lib/dclaw/app.sqlite" }
    }),
    {
      dataDir: "/var/lib/dclaw",
      databasePath: "/var/lib/dclaw/app.sqlite"
    }
  );
});

test("database initialization creates the new database without touching a legacy sentinel", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "dclaw-runtime-paths-"));
  const dataDir = path.join(cwd, "data");
  const sentinelPath = path.join(dataDir, "omnichannel-bot-service.sqlite");
  const databasePath = path.join(dataDir, "dclaw-omnichannel-service.sqlite");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(sentinelPath, "");

  try {
    const dbUrl = new URL("../src/db.js", import.meta.url).href;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", `await import(${JSON.stringify(dbUrl)})`], {
      cwd,
      env: { ...process.env, DATA_DIR: "", DATABASE_PATH: "" },
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.statSync(sentinelPath).size, 0);
    assert.equal(fs.existsSync(databasePath), true);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
