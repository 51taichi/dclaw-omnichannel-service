import assert from "node:assert/strict";
import test from "node:test";
import { activationDelayMs } from "../src/activation-timing.js";

test("zero-minute activation waits five seconds for every attempt", () => {
  assert.equal(activationDelayMs(0, 1), 5_000);
  assert.equal(activationDelayMs(0, 3), 5_000);
});

test("positive activation minutes retain exponential retry timing", () => {
  assert.equal(activationDelayMs(2, 1), 120_000);
  assert.equal(activationDelayMs(2, 3), 480_000);
});
