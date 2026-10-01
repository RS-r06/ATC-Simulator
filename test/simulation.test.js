import assert from "node:assert/strict";
import { test } from "node:test";

import { Aircraft } from "../src/aircraft.js";
import { POINTS, Simulation } from "../src/simulation.js";

function quietSim() {
  return new Simulation({ seed: 1, spawning: false });
}

function arrival(overrides = {}) {
  return new Aircraft({
    callsign: "TST1",
    type: "A320",
    kind: "arrival",
    x: 20,
    y: 10,
    heading: 270,
    altitude: 5000,
    speed: 220,
    ...overrides,
  });
}

test("turns at about 3 degrees a second", () => {
  const sim = quietSim();
  const ac = sim.add(arrival({ heading: 0, x: 0, y: -20 }));
  sim.command("TST1 H090");
  sim.advance(10);
  assert.ok(Math.abs(ac.heading - 30) < 1, `heading ${ac.heading}`);
  sim.advance(30);
  assert.equal(ac.heading, 90);
});

test("forced left turn goes the long way", () => {
  const sim = quietSim();
  const ac = sim.add(arrival({ heading: 0, x: 0, y: -20 }));
  sim.command("TST1 L090");
  sim.advance(5);
  assert.ok(ac.heading > 300, `heading ${ac.heading}`);
});

test("climbs at the type's climb rate", () => {
  const sim = quietSim();
  const ac = sim.add(arrival({ altitude: 4000 }));
  sim.command("TST1 A60");
  sim.advance(30); // A320 climbs 2500 ft a minute
  assert.ok(Math.abs(ac.altitude - 5250) < 20, `altitude ${ac.altitude}`);
});

test("moves at its speed", () => {
  const sim = quietSim();
  const ac = sim.add(arrival({ x: 20, y: 10, heading: 270, speed: 240 }));
  sim.command("TST1 S240");
  sim.advance(60); // 240 kt is 4 nm a minute
  assert.ok(Math.abs(ac.x - 16) < 0.05, `x ${ac.x}`);
});

test("a bad command changes nothing", () => {
  const sim = quietSim();
  const ac = sim.add(arrival());
  const result = sim.command("TST1 H180 S400");
  assert.equal(result.ok, false);
  assert.equal(ac.target.heading, 270);
  assert.equal(sim.command("NOPE1 H180").ok, false);
});

test("an arrival vectored onto the ILS lands and scores", () => {
  const sim = quietSim();
  // 15 nm out, 3 nm north of the centre line, heading to cut across it at 3000 ft.
  sim.add(arrival({ x: 16, y: 3, heading: 220, altitude: 3000, speed: 200 }));
  assert.equal(sim.command("TST1 S180 ILS").ok, true);
  sim.advance(600);
  assert.equal(sim.aircraft.length, 0);
  assert.equal(sim.stats.landed, 1);
  assert.equal(sim.score, POINTS.landed);
});

test("direct KILNO with ILS clearance lands from the far side", () => {
  const sim = quietSim();
  // North west of the airport, so it reaches KILNO heading south east.
  sim.add(arrival({ x: -10, y: 15, heading: 120, altitude: 5000, speed: 220 }));
  assert.equal(sim.command("TST1 D KILNO A30 S200 ILS").ok, true);
  sim.advance(1200);
  assert.equal(sim.stats.landed, 1);
  assert.equal(sim.stats.goArounds, 0);
});

test("an aircraft far too high on final goes around", () => {
  const sim = quietSim();
  const ac = sim.add(arrival({ x: 6, y: 0, heading: 270, altitude: 8000, speed: 180 }));
  sim.command("TST1 ILS");
  sim.advance(200);
  assert.equal(sim.stats.goArounds, 1);
  assert.equal(ac.ils.cleared, false);
  assert.equal(sim.score, POINTS.goAround);
});

test("losing separation costs points once per pair", () => {
  const sim = quietSim();
  sim.add(arrival({ callsign: "AAA1", x: 10, y: 10, heading: 90, altitude: 5000 }));
  sim.add(arrival({ callsign: "BBB2", x: 14, y: 10, heading: 270, altitude: 5500 }));
  sim.advance(60);
  assert.equal(sim.stats.conflicts, 1);
  assert.equal(sim.score, POINTS.conflict);
});

test("1000 ft apart is enough", () => {
  const sim = quietSim();
  sim.add(arrival({ callsign: "AAA1", x: 10, y: 10, heading: 90, altitude: 5000 }));
  sim.add(arrival({ callsign: "BBB2", x: 14, y: 10, heading: 270, altitude: 6000 }));
  sim.advance(60);
  assert.equal(sim.stats.conflicts, 0);
});

test("a departure takes off, climbs out and is handed off at its fix", () => {
  const sim = quietSim();
  const dep = sim.add(
    new Aircraft({ callsign: "DEP1", type: "B738", kind: "departure", x: 0.8, y: 0, heading: 270, exitFix: "WENDY" }),
  );
  dep.target = { heading: 270, altitude: 3000, speed: 250, turn: null, fix: null };
  assert.equal(sim.command("DEP1 T A60").ok, true);
  sim.advance(30);
  assert.equal(dep.state, "takeoff"); // a B738 rotates at 150 kt, about 38 s into the roll
  sim.advance(15);
  assert.equal(dep.state, "airborne");
  sim.advance(900);
  assert.equal(sim.stats.handedOff, 1);
  assert.equal(sim.score, POINTS.handedOff);
});

test("takeoff is refused while an arrival is on short final", () => {
  const sim = quietSim();
  sim.add(arrival({ x: 2.5, y: 0, heading: 270, altitude: 600, speed: 140 })).ils.established = true;
  sim.add(new Aircraft({ callsign: "DEP1", type: "A320", kind: "departure", exitFix: "NOLDA" }));
  const result = sim.command("DEP1 T");
  assert.equal(result.ok, false);
  assert.match(result.message, /runway/);
});

test("an arrival that leaves the sector is lost", () => {
  const sim = quietSim();
  sim.add(arrival({ x: 39, y: 0, heading: 90 }));
  sim.advance(60);
  assert.equal(sim.stats.lost, 1);
  assert.equal(sim.score, POINTS.lost);
});

test("the same seed spawns the same traffic", () => {
  const a = new Simulation({ seed: 7 });
  const b = new Simulation({ seed: 7 });
  a.advance(600);
  b.advance(600);
  const snapshot = (sim) => sim.aircraft.map((ac) => [ac.callsign, ac.type, ac.altitude]);
  assert.ok(a.aircraft.length > 0);
  assert.deepEqual(snapshot(a), snapshot(b));
});
