// Draws the radar picture onto a canvas.

const COLORS = {
  background: "#0b100e",
  ring: "#17241f",
  sector: "#2c4a3d",
  runway: "#d6e4dc",
  centreLine: "#3d6b56",
  fix: "#6f8a7d",
  arrival: "#5cc8ff",
  departure: "#ffc857",
  danger: "#ff5a5a",
  selected: "#ffffff",
  text: "#d6e4dc",
};

const VIEW_NM = 43; // half the width of the picture, in nm

export class Radar {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.resize();
  }

  resize() {
    const ratio = window.devicePixelRatio || 1;
    const { width, height } = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.width = width;
    this.height = height;
    this.scale = Math.min(width, height) / (2 * VIEW_NM);
  }

  // Screen position of a point in nm. North is up.
  toScreen(p) {
    return { x: this.width / 2 + p.x * this.scale, y: this.height / 2 - p.y * this.scale };
  }

  // The aircraft nearest a screen point, within 20 px, or null.
  pick(sim, sx, sy) {
    let best = null;
    let bestDist = 20;
    for (const ac of sim.aircraft) {
      if (!ac.isAirborne() && ac.state !== "takeoff") continue;
      const p = this.toScreen(ac.position);
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d < bestDist) {
        best = ac;
        bestDist = d;
      }
    }
    return best;
  }

  draw(sim, selected) {
    const { ctx } = this;
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, this.width, this.height);
    this.#drawRings(sim.airport);
    this.#drawCentreLine(sim.airport.runway);
    this.#drawFixes(sim.airport.fixes);
    this.#drawRunway(sim.airport.runway);
    for (const ac of sim.aircraft) {
      if (ac.state === "waiting") continue;
      this.#drawAircraft(ac, sim.inConflict(ac), ac === selected);
    }
  }

  #drawRings(airport) {
    const { ctx } = this;
    const c = this.toScreen({ x: 0, y: 0 });
    ctx.lineWidth = 1;
    ctx.strokeStyle = COLORS.ring;
    for (let r = 10; r < airport.radius; r += 10) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, r * this.scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = COLORS.sector;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.arc(c.x, c.y, airport.radius * this.scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COLORS.fix;
    ctx.font = "11px ui-monospace, Consolas, monospace";
    for (let r = 10; r < airport.radius; r += 10) ctx.fillText(`${r}`, c.x + 3, c.y - r * this.scale - 3);
  }

  #drawCentreLine(runway) {
    const { ctx } = this;
    const start = this.toScreen(runway.threshold);
    const end = this.toScreen({ x: runway.threshold.x + 18, y: runway.threshold.y });
    ctx.strokeStyle = COLORS.centreLine;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.setLineDash([]);
    // A tick every 5 nm along the approach.
    for (let nm = 5; nm <= 15; nm += 5) {
      const p = this.toScreen({ x: runway.threshold.x + nm, y: runway.threshold.y });
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 5);
      ctx.lineTo(p.x, p.y + 5);
      ctx.stroke();
    }
  }

  #drawRunway(runway) {
    const { ctx } = this;
    const a = this.toScreen(runway.threshold);
    const b = this.toScreen(runway.end);
    ctx.strokeStyle = COLORS.runway;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = COLORS.text;
    ctx.fillText(runway.name, a.x + 4, a.y + 14);
  }

  #drawFixes(fixes) {
    const { ctx } = this;
    ctx.font = "11px ui-monospace, Consolas, monospace";
    for (const [name, fix] of Object.entries(fixes)) {
      const p = this.toScreen(fix);
      ctx.strokeStyle = COLORS.fix;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 5);
      ctx.lineTo(p.x + 5, p.y + 4);
      ctx.lineTo(p.x - 5, p.y + 4);
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = COLORS.fix;
      const left = fix.x > 30;
      ctx.textAlign = left ? "right" : "left";
      ctx.fillText(name, p.x + (left ? -8 : 8), p.y + 4);
      ctx.textAlign = "left";
    }
  }

  #drawAircraft(ac, conflict, selected) {
    const { ctx } = this;
    const color = conflict ? COLORS.danger : selected ? COLORS.selected : ac.kind === "arrival" ? COLORS.arrival : COLORS.departure;
    const p = this.toScreen(ac.position);

    // Trail of earlier positions.
    ctx.fillStyle = color;
    ac.history.forEach((h, i) => {
      const q = this.toScreen(h);
      ctx.globalAlpha = 0.15 + (0.5 * i) / ac.history.length;
      ctx.fillRect(q.x - 1.5, q.y - 1.5, 3, 3);
    });
    ctx.globalAlpha = 1;

    // Where it will be in one minute.
    const rad = (ac.heading * Math.PI) / 180;
    const ahead = ac.speed / 60;
    const tip = this.toScreen({ x: ac.x + Math.sin(rad) * ahead, y: ac.y + Math.cos(rad) * ahead });
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();

    // The blip.
    ctx.lineWidth = selected ? 2 : 1.5;
    ctx.strokeRect(p.x - 4, p.y - 4, 8, 8);
    ctx.lineWidth = 1;

    // Half the separation minimum round aircraft in conflict: rings that
    // overlap mean less than 3 nm apart.
    if (conflict) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.5 * this.scale, 0, Math.PI * 2);
      ctx.stroke();
    }

    // When selected, show where a direct-to is taking it.
    if (selected && ac.target.fix) {
      const f = this.toScreen(ac.target.fix);
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(f.x, f.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Data block: callsign, then altitude in hundreds of feet with trend and
    // cleared level, then speed in tens of knots and a status tag.
    const alt = String(Math.round(ac.altitude / 100)).padStart(3, "0");
    const trend = ["↓", "", "↑"][ac.verticalTrend() + 1];
    const cleared = ac.ils.established || trend === "" ? "" : String(ac.target.altitude / 100).padStart(3, "0");
    const tag = ac.kind === "departure" ? ac.exitFix : ac.ils.established ? "LOC" : ac.ils.cleared ? "ILS" : "";
    const lines = [ac.callsign, `${alt}${trend}${cleared}`, `${Math.round(ac.speed / 10)} ${tag}`.trim()];
    ctx.font = `${selected ? "bold " : ""}12px ui-monospace, Consolas, monospace`;
    ctx.fillStyle = color;
    lines.forEach((line, i) => ctx.fillText(line, p.x + 12, p.y - 14 + i * 13));
  }
}
