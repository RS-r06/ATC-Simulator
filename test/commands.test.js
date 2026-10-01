import assert from "node:assert/strict";
import { test } from "node:test";

import { parseCommand } from "../src/commands.js";

test("reads several instructions at once", () => {
  const { callsign, actions } = parseCommand("baw12 h270 a40 s210");
  assert.equal(callsign, "BAW12");
  assert.deepEqual(actions, [
    { type: "heading", value: 270, turn: null },
    { type: "altitude", value: 4000 },
    { type: "speed", value: 210 },
  ]);
});

test("reads forced turns, direct to, ILS and takeoff", () => {
  const { actions } = parseCommand("SAA1 L090 D KILNO ILS T");
  assert.deepEqual(actions, [
    { type: "heading", value: 90, turn: "L" },
    { type: "direct", fix: "KILNO" },
    { type: "ils" },
    { type: "takeoff" },
  ]);
  assert.deepEqual(parseCommand("SAA1 DKILNO").actions, [{ type: "direct", fix: "KILNO" }]);
});

test("heading 360 means north", () => {
  assert.equal(parseCommand("KLM5 H360").actions[0].value, 0);
});

test("rejects nonsense", () => {
  assert.match(parseCommand("").error, /callsign/);
  assert.match(parseCommand("KLM5").error, /No instruction/);
  assert.match(parseCommand("KLM5 H400").error, /not between/);
  assert.match(parseCommand("KLM5 JUMP").error, /JUMP/);
  assert.match(parseCommand("KLM5 D").error, /fix name/);
});
