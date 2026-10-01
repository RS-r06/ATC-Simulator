import assert from "node:assert/strict";
import { test } from "node:test";

import { bearing, formatHeading, headingDiff, normalizeHeading, seededRandom } from "../src/geo.js";

test("headings wrap round the compass", () => {
  assert.equal(normalizeHeading(370), 10);
  assert.equal(normalizeHeading(-90), 270);
});

test("headingDiff takes the short way round", () => {
  assert.equal(headingDiff(350, 10), 20);
  assert.equal(headingDiff(10, 350), -20);
  assert.equal(headingDiff(90, 270), 180);
});

test("bearing points the right way", () => {
  const origin = { x: 0, y: 0 };
  assert.equal(bearing(origin, { x: 0, y: 5 }), 0);
  assert.equal(bearing(origin, { x: 5, y: 0 }), 90);
  assert.equal(bearing(origin, { x: -5, y: 0 }), 270);
});

test("formatHeading shows north as 360 with three digits", () => {
  assert.equal(formatHeading(0), "360");
  assert.equal(formatHeading(90), "090");
});

test("the same seed gives the same numbers", () => {
  const a = seededRandom(42);
  const b = seededRandom(42);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});
