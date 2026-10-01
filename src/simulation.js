// The game: the aircraft, the clock, the controller's instructions and the score.
//
// Nothing in here touches the page, so the tests can run it in Node.

import { Aircraft, TYPES, glideslopeAltitude } from "./aircraft.js";
import { AIRPORT, MAX_ALTITUDE, MIN_ALTITUDE, RADAR_FLOOR_FT, SEPARATION } from "./airport.js";
import { parseCommand } from "./commands.js";
import { bearing, distance, formatHeading, seededRandom } from "./geo.js";

export const POINTS = {
  landed: 10,
  handedOff: 10,
  wrongExit: -5,
  goAround: -5,
  lost: -10,
  conflict: -20,
};

const AIRLINES = ["SAA", "BAW", "KLM", "DLH", "UAE", "QTR", "ETH", "KQA", "AFR", "RAM"];
const STEP = 0.25; // seconds per physics step

export class Simulation {
  constructor({ seed = Date.now(), airport = AIRPORT, spawning = true } = {}) {
    this.airport = airport;
    this.random = seededRandom(seed);
    this.spawning = spawning;
    this.time = 0;
    this.aircraft = [];
    this.score = 0;
    this.stats = { landed: 0, handedOff: 0, wrongExit: 0, goArounds: 0, lost: 0, conflicts: 0 };
    this.log = [];
    this.conflicts = new Set(); // pairs in conflict right now, as "AAA|BBB"
    this.nextArrival = 5;
    this.nextDeparture = 40;
    this.arrivalGap = 100;
    this.departureGap = 130;
    this.leftover = 0;
  }

  // Advance the game by dt seconds, in small fixed steps.
  advance(dt) {
    this.leftover += dt;
    while (this.leftover >= STEP) {
      this.leftover -= STEP;
      this.step(STEP);
    }
  }

  step(dt) {
    this.time += dt;
    if (this.spawning) this.#spawn();
    for (const ac of this.aircraft) ac.update(dt, this.airport.runway);
    this.#checkApproaches();
    this.#checkBoundary();
    this.#checkSeparation();
  }

  add(aircraft) {
    this.aircraft.push(aircraft);
    return aircraft;
  }

  find(callsign) {
    return this.aircraft.find((ac) => ac.callsign === callsign.toUpperCase());
  }

  note(text, kind = "info") {
    this.log.push({ time: this.time, text, kind });
    if (this.log.length > 200) this.log.shift();
  }

  // Apply a typed instruction. Returns { ok, message }.
  command(text) {
    const parsed = parseCommand(text);
    if (parsed.error) return this.#reject(parsed.error);
    const ac = this.find(parsed.callsign);
    if (!ac) return this.#reject(`No aircraft called ${parsed.callsign}.`);

    // Check every action before applying any, so a bad command changes nothing.
    for (const action of parsed.actions) {
      const problem = this.#problemWith(ac, action);
      if (problem) return this.#reject(`${ac.callsign}: ${problem}`);
    }
    const readback = parsed.actions.map((action) => this.#apply(ac, action));
    const message = `${ac.callsign}: ${readback.join(", ")}`;
    this.note(message, "readback");
    return { ok: true, message };
  }

  runwayBusy() {
    const { runway } = this.airport;
    return this.aircraft.some(
      (ac) =>
        ac.state === "takeoff" ||
        (ac.ils.established && ac.x - runway.threshold.x < 3 && ac.altitude < 1500),
    );
  }

  #reject(message) {
    this.note(message, "error");
    return { ok: false, message };
  }

  #problemWith(ac, action) {
    switch (action.type) {
      case "altitude":
        if (action.value < MIN_ALTITUDE || action.value > MAX_ALTITUDE)
          return `altitude must be between ${MIN_ALTITUDE} and ${MAX_ALTITUDE} ft.`;
        if (ac.ils.established) return "established on the ILS, the glide slope sets the altitude.";
        return null;
      case "speed":
        if (action.value < ac.perf.minSpeed || action.value > ac.perf.maxSpeed)
          return `a ${ac.type} can fly ${ac.perf.minSpeed} to ${ac.perf.maxSpeed} kt here.`;
        return null;
      case "direct":
        return this.airport.fixes[action.fix] ? null : `there is no fix called ${action.fix}.`;
      case "ils":
        return ac.kind === "arrival" ? null : "departures cannot be cleared to land.";
      case "takeoff":
        if (ac.state !== "waiting") return "is not waiting at the runway.";
        if (this.runwayBusy()) return "runway is not clear yet.";
        return null;
      default:
        return null;
    }
  }

  #apply(ac, action) {
    switch (action.type) {
      case "heading":
        ac.target.heading = action.value;
        ac.target.turn = action.turn;
        ac.target.fix = null;
        ac.ils.cleared = ac.ils.established = false;
        return `${action.turn === "L" ? "turn left " : action.turn === "R" ? "turn right " : ""}heading ${formatHeading(action.value)}`;
      case "altitude": {
        const verb = action.value > ac.altitude ? "climb" : "descend";
        ac.target.altitude = action.value;
        return `${verb} ${action.value} ft`;
      }
      case "speed":
        ac.target.speed = action.value;
        return `speed ${action.value} kt`;
      case "direct":
        ac.target.fix = this.airport.fixes[action.fix];
        ac.ils.established = false;
        return `direct ${action.fix}`;
      case "ils":
        ac.ils.cleared = true;
        return `cleared ILS runway ${this.airport.runway.name}`;
      case "takeoff": {
        const { runway } = this.airport;
        ac.state = "takeoff";
        ac.x = runway.threshold.x;
        ac.y = runway.threshold.y;
        ac.heading = runway.heading;
        ac.speed = 0;
        ac.altitude = 0;
        return `cleared for takeoff runway ${runway.name}`;
      }
    }
  }

  #award(key, statKey, text, kind) {
    this.score += POINTS[key];
    this.stats[statKey] += 1;
    this.note(`${text} (${POINTS[key] > 0 ? "+" : ""}${POINTS[key]})`, kind);
  }

  #checkApproaches() {
    const { runway } = this.airport;
    for (const ac of [...this.aircraft]) {
      if (!ac.ils.established) continue;
      const out = ac.x - runway.threshold.x;
      const highBy = ac.altitude - glideslopeAltitude(ac, runway);
      const unstable = out < 2 && highBy > 500;
      if (out > 0 && !unstable) continue;

      const onCentreLine = Math.abs(ac.y - runway.threshold.y) < 0.5;
      if (!unstable && ac.altitude <= 400 && onCentreLine && ac.speed <= ac.perf.approach + 30) {
        this.aircraft.splice(this.aircraft.indexOf(ac), 1);
        this.#award("landed", "landed", `${ac.callsign} landed`, "good");
      } else {
        ac.ils.cleared = ac.ils.established = false;
        ac.target = { heading: runway.heading, altitude: 3000, speed: 200, turn: null, fix: null };
        this.#award("goAround", "goArounds", `${ac.callsign} going around, too high or fast`, "bad");
      }
    }
  }

  #checkBoundary() {
    const centre = { x: 0, y: 0 };
    for (const ac of [...this.aircraft]) {
      if (!ac.isAirborne() || distance(ac.position, centre) <= this.airport.radius) continue;
      this.aircraft.splice(this.aircraft.indexOf(ac), 1);
      if (ac.kind === "arrival") {
        this.#award("lost", "lost", `${ac.callsign} left the sector without landing`, "bad");
        continue;
      }
      const fix = this.airport.fixes[ac.exitFix];
      if (distance(ac.position, fix) <= 10 && ac.altitude >= 5000) {
        this.#award("handedOff", "handedOff", `${ac.callsign} handed off at ${ac.exitFix}`, "good");
      } else {
        this.#award("wrongExit", "wrongExit", `${ac.callsign} left the sector off route or below 5000 ft`, "bad");
      }
    }
  }

  #checkSeparation() {
    const flying = this.aircraft.filter((ac) => ac.isAirborne() && ac.altitude >= RADAR_FLOOR_FT);
    const now = new Set();
    for (let i = 0; i < flying.length; i++) {
      for (let j = i + 1; j < flying.length; j++) {
        const a = flying[i];
        const b = flying[j];
        if (distance(a.position, b.position) >= SEPARATION.lateralNm) continue;
        if (Math.abs(a.altitude - b.altitude) >= SEPARATION.verticalFt) continue;
        const key = [a.callsign, b.callsign].sort().join("|");
        now.add(key);
        if (!this.conflicts.has(key)) {
          this.#award("conflict", "conflicts", `Separation lost: ${a.callsign} and ${b.callsign}`, "bad");
        }
      }
    }
    this.conflicts = now;
  }

  inConflict(ac) {
    for (const key of this.conflicts) if (key.split("|").includes(ac.callsign)) return true;
    return false;
  }

  #spawn() {
    if (this.time >= this.nextArrival) {
      this.#spawnArrival();
      this.arrivalGap = Math.max(50, this.arrivalGap * 0.97);
      this.nextArrival = this.time + this.arrivalGap * (0.8 + this.random() * 0.4);
    }
    if (this.time >= this.nextDeparture) {
      if (this.aircraft.filter((ac) => ac.state === "waiting").length < 4) this.#spawnDeparture();
      this.departureGap = Math.max(60, this.departureGap * 0.97);
      this.nextDeparture = this.time + this.departureGap * (0.8 + this.random() * 0.4);
    }
  }

  #pick(list) {
    return list[Math.floor(this.random() * list.length)];
  }

  #newCallsign() {
    for (;;) {
      const callsign = this.#pick(AIRLINES) + String(10 + Math.floor(this.random() * 990));
      if (!this.find(callsign)) return callsign;
    }
  }

  #fixNames(role) {
    return Object.entries(this.airport.fixes)
      .filter(([, fix]) => fix.role === role)
      .map(([name]) => name);
  }

  #spawnArrival() {
    const entry = this.airport.fixes[this.#pick(this.#fixNames("entry"))];
    // Pick a level that keeps clear of anything already near the entry point.
    const levels = [8000, 9000, 10000, 11000, 12000].filter(
      (alt) =>
        !this.aircraft.some(
          (ac) => distance(ac.position, entry) < 8 && Math.abs(ac.altitude - alt) < 1000,
        ),
    );
    if (levels.length === 0) return;
    const altitude = this.#pick(levels);
    const type = this.#pick(Object.keys(TYPES));
    const heading = bearing(entry, { x: 0, y: 0 });
    const speed = Math.min(250, TYPES[type].maxSpeed);
    const ac = this.add(
      new Aircraft({ callsign: this.#newCallsign(), type, kind: "arrival", x: entry.x, y: entry.y, heading, altitude, speed }),
    );
    this.note(`${ac.callsign} (${type}) checking in at ${altitude} ft, inbound to land`, "info");
  }

  #spawnDeparture() {
    const type = this.#pick(Object.keys(TYPES));
    const exitFix = this.#pick(this.#fixNames("exit"));
    const { runway } = this.airport;
    const ac = this.add(
      new Aircraft({
        callsign: this.#newCallsign(),
        type,
        kind: "departure",
        x: runway.threshold.x,
        y: runway.threshold.y,
        heading: runway.heading,
        exitFix,
      }),
    );
    ac.target = { heading: runway.heading, altitude: 3000, speed: Math.min(250, ac.perf.maxSpeed), turn: null, fix: null };
    this.note(`${ac.callsign} (${type}) ready for departure, leaving by ${exitFix}`, "info");
  }
}
