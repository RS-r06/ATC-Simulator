// One aircraft and how it flies.
//
// Each update moves the aircraft a small time step towards whatever the
// controller last told it: a heading or a fix, an altitude and a speed. Once it
// is established on the ILS it flies the approach by itself.

import { GLIDESLOPE_FT_PER_NM } from "./airport.js";
import { bearing, clamp, distance, headingDiff, normalizeHeading } from "./geo.js";

// Rough performance figures. Rates are in feet per minute, speeds in knots.
export const TYPES = {
  A320: { climb: 2500, descent: 2000, approach: 140, minSpeed: 160, maxSpeed: 250, rotate: 145 },
  B738: { climb: 2500, descent: 2200, approach: 145, minSpeed: 160, maxSpeed: 250, rotate: 150 },
  E190: { climb: 2800, descent: 2000, approach: 135, minSpeed: 160, maxSpeed: 250, rotate: 135 },
  DH8D: { climb: 1800, descent: 1500, approach: 120, minSpeed: 150, maxSpeed: 240, rotate: 115 },
};

const TURN_RATE = 3; // degrees per second, a standard rate turn
const ACCEL = 2; // knots per second
const DECEL = 1.5;
const TAKEOFF_ACCEL = 4;
const HISTORY_INTERVAL = 4; // seconds between trail dots
const HISTORY_LENGTH = 6;

export class Aircraft {
  constructor({ callsign, type, kind, x = 0, y = 0, heading = 0, altitude = 0, speed = 0, exitFix = null }) {
    this.callsign = callsign;
    this.type = type;
    this.perf = TYPES[type];
    this.kind = kind; // "arrival" or "departure"
    this.exitFix = exitFix; // departures only: the fix they must leave by
    this.x = x;
    this.y = y;
    this.heading = heading;
    this.altitude = altitude;
    this.speed = speed;
    // "waiting" at the runway, "takeoff" roll, or "airborne".
    this.state = kind === "departure" ? "waiting" : "airborne";
    this.target = { heading, altitude, speed, turn: null, fix: null };
    this.ils = { cleared: false, established: false };
    this.history = [];
    this.historyClock = 0;
  }

  get position() {
    return { x: this.x, y: this.y };
  }

  isAirborne() {
    return this.state === "airborne";
  }

  // The trend of the altitude: 1 climbing, -1 descending, 0 level.
  verticalTrend() {
    if (this.ils.established) return -1;
    const goal = this.target.altitude;
    if (Math.abs(goal - this.altitude) < 50) return 0;
    return goal > this.altitude ? 1 : -1;
  }

  update(dt, runway) {
    if (this.state === "waiting") return;
    if (this.state === "takeoff") this.#updateTakeoff(dt);
    else this.#updateAirborne(dt, runway);
    this.#move(dt);
    this.#recordHistory(dt);
  }

  #updateTakeoff(dt) {
    this.speed += TAKEOFF_ACCEL * dt;
    if (this.speed >= this.perf.rotate) {
      this.state = "airborne";
      this.altitude = 1;
    }
  }

  #updateAirborne(dt, runway) {
    this.#steer(dt, runway);
    this.#climbOrDescend(dt, runway);
    this.#changeSpeed(dt, runway);
    if (this.ils.cleared && !this.ils.established) this.#tryCaptureLocalizer(runway);
  }

  #steer(dt, runway) {
    // Hold runway heading until 400 ft after takeoff.
    if (this.altitude < 400 && this.kind === "departure") return;

    let desired;
    let forced = null;
    if (this.ils.established) {
      desired = localizerHeading(this, runway);
    } else if (this.target.fix) {
      desired = bearing(this.position, this.target.fix);
      if (distance(this.position, this.target.fix) < 0.5) {
        // Over the fix. Cleared for the ILS via the approach fix, it turns
        // onto the final approach from any direction. Otherwise it carries on
        // along its current heading.
        if (this.ils.cleared && this.target.fix.role === "approach") {
          this.ils.established = true;
          desired = localizerHeading(this, runway);
        }
        this.target.heading = this.heading;
        this.target.fix = null;
      }
    } else {
      desired = this.target.heading;
      forced = this.target.turn;
    }

    let diff = headingDiff(this.heading, desired);
    if (forced === "L" && diff > 0) diff -= 360;
    if (forced === "R" && diff < 0) diff += 360;
    const step = TURN_RATE * dt;
    if (Math.abs(diff) <= step) {
      this.heading = normalizeHeading(desired);
      if (forced) this.target.turn = null;
    } else {
      this.heading = normalizeHeading(this.heading + Math.sign(diff) * step);
    }
  }

  #climbOrDescend(dt, runway) {
    if (this.ils.established) {
      // Follow the glide slope down. Below it, hold height until it is met.
      const slope = glideslopeAltitude(this, runway);
      if (this.altitude > slope) {
        this.altitude = Math.max(slope, this.altitude - (this.perf.descent / 60) * dt * 1.5);
      }
      return;
    }
    const goal = this.target.altitude;
    const rate = (goal > this.altitude ? this.perf.climb : this.perf.descent) / 60;
    const step = rate * dt;
    if (Math.abs(goal - this.altitude) <= step) this.altitude = goal;
    else this.altitude += Math.sign(goal - this.altitude) * step;
  }

  #changeSpeed(dt, runway) {
    let goal = this.target.speed;
    if (this.ils.established) {
      const out = this.x - runway.threshold.x;
      goal = out < 6 ? this.perf.approach : Math.min(goal, 180);
    }
    const step = (goal > this.speed ? ACCEL : DECEL) * dt;
    if (Math.abs(goal - this.speed) <= step) this.speed = goal;
    else this.speed += Math.sign(goal - this.speed) * step;
  }

  #tryCaptureLocalizer(runway) {
    const out = this.x - runway.threshold.x;
    if (out <= 0.5 || out > 25) return;
    const offset = this.y - runway.threshold.y;
    const angle = Math.abs(headingDiff(this.heading, runway.heading));
    if (angle > 90) return;

    // Start the turn early enough not to overshoot: the lateral distance a
    // standard rate turn needs to swing round onto the centre line.
    const radius = this.speed / 3600 / ((TURN_RATE * Math.PI) / 180);
    const lead = Math.max(0.3, radius * (1 - Math.cos((angle * Math.PI) / 180)));
    const crossTrackSpeed = Math.cos((this.heading * Math.PI) / 180); // north component
    const closing = offset === 0 || Math.sign(crossTrackSpeed) === -Math.sign(offset) || angle < 10;
    if (Math.abs(offset) <= lead && closing) {
      this.ils.established = true;
      this.target.fix = null;
      this.target.turn = null;
    }
  }

  #move(dt) {
    const nmPerSecond = this.speed / 3600;
    const rad = (this.heading * Math.PI) / 180;
    this.x += Math.sin(rad) * nmPerSecond * dt;
    this.y += Math.cos(rad) * nmPerSecond * dt;
  }

  #recordHistory(dt) {
    this.historyClock += dt;
    if (this.historyClock >= HISTORY_INTERVAL) {
      this.historyClock = 0;
      this.history.push({ x: this.x, y: this.y });
      if (this.history.length > HISTORY_LENGTH) this.history.shift();
    }
  }
}

// The approach maths below assumes a runway pointing west, like runway 27,
// so that "distance out" is simply how far east of the threshold you are.

// Heading that brings the aircraft onto the centre line and keeps it there.
export function localizerHeading(ac, runway) {
  const offset = ac.y - runway.threshold.y; // positive: north of the centre line
  const correction = clamp(offset * 40, -30, 30);
  return normalizeHeading(runway.heading - correction);
}

export function glideslopeAltitude(ac, runway) {
  const out = Math.max(0, ac.x - runway.threshold.x);
  return out * GLIDESLOPE_FT_PER_NM;
}
