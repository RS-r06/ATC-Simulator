// Wires the simulation to the page: the game loop, the radar, the command
// line and the side panel.

import { formatHeading } from "./geo.js";
import { Radar } from "./radar.js";
import { Simulation } from "./simulation.js";

const $ = (id) => document.getElementById(id);
const canvas = $("radar");
const input = $("command");
const feedback = $("feedback");

const radar = new Radar(canvas);
let sim;
let selected = null;
let paused = false;
let rate = 1;
let history = [];
let historyIndex = 0;
let lastTick = performance.now();

function newGame() {
  // ?seed=123 in the address bar replays the same traffic.
  const seed = Number(new URLSearchParams(location.search).get("seed")) || Date.now();
  sim = new Simulation({ seed });
  selected = null;
  sim.note("Radar on. Traffic will call in shortly. Click Help for the commands.", "info");
  setFeedback("", "");
  renderPanel();
}

function setFeedback(text, kind) {
  feedback.textContent = text;
  feedback.className = `feedback ${kind}`;
}

function select(ac) {
  selected = ac;
  input.value = ac ? `${ac.callsign} ` : "";
  input.focus();
  renderPanel();
}

// Game time runs on its own timer, so it keeps pace however often the
// browser redraws. The radar redraws on every animation frame.
function tick() {
  const now = performance.now();
  // Cap the step so a tab left in the background does not jump ahead on return.
  const dt = Math.min(1, (now - lastTick) / 1000);
  lastTick = now;
  if (!paused) sim.advance(dt * rate);
  if (selected && !sim.aircraft.includes(selected)) selected = null;
  renderPanel();
}

function frame() {
  radar.draw(sim, selected);
  requestAnimationFrame(frame);
}

function clock(seconds) {
  const s = Math.floor(seconds);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function renderPanel() {
  $("score").textContent = sim.score;
  $("clock").textContent = clock(sim.time);
  $("landed").textContent = sim.stats.landed;
  $("handed").textContent = sim.stats.handedOff;
  $("conflicts").textContent = sim.stats.conflicts;
  renderStrips();
  renderLog();
}

function renderStrips() {
  const list = $("strips");
  const order = { waiting: 0, takeoff: 1, airborne: 2 };
  const sorted = [...sim.aircraft].sort((a, b) => order[a.state] - order[b.state] || a.callsign.localeCompare(b.callsign));
  list.replaceChildren(
    ...sorted.map((ac) => {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = `strip ${ac.kind}${sim.inConflict(ac) ? " conflict" : ""}${ac === selected ? " selected" : ""}`;
      const where =
        ac.state === "waiting"
          ? "ready at runway 27, type T to clear for takeoff"
          : ac.state === "takeoff"
            ? "rolling"
            : `${formatHeading(ac.heading)}  ${Math.round(ac.altitude)} ft  ${Math.round(ac.speed)} kt`;
      const goal = ac.kind === "departure" ? `exit ${ac.exitFix}` : ac.ils.established ? "on the ILS" : ac.ils.cleared ? "cleared ILS" : "to land";
      button.dataset.callsign = ac.callsign;
      button.innerHTML = `<span>${ac.callsign} ${ac.type}</span><span>${goal}</span><span class="sub">${where}</span>`;
      li.append(button);
      return li;
    }),
  );
}

function renderLog() {
  const list = $("log");
  const recent = sim.log.slice(-40).reverse();
  list.replaceChildren(
    ...recent.map((entry) => {
      const li = document.createElement("li");
      li.className = entry.kind;
      const time = document.createElement("time");
      time.textContent = clock(entry.time);
      li.append(time, entry.text);
      return li;
    }),
  );
}

$("command-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  if (text.toUpperCase() === "HELP") {
    toggleHelp(true);
    input.value = "";
    return;
  }
  history.push(text);
  historyIndex = history.length;
  const result = sim.command(text);
  setFeedback(result.message, result.ok ? "ok" : "error");
  if (result.ok) input.value = selected ? `${selected.callsign} ` : "";
  renderPanel();
});

input.addEventListener("keydown", (event) => {
  if (event.key === "ArrowUp" && historyIndex > 0) {
    historyIndex -= 1;
    input.value = history[historyIndex];
    event.preventDefault();
  } else if (event.key === "ArrowDown" && historyIndex < history.length) {
    historyIndex += 1;
    input.value = history[historyIndex] ?? "";
    event.preventDefault();
  } else if (event.key === "Escape") {
    select(null);
  }
});

// The strips are redrawn four times a second, which can swap a button out
// between press and release, so select on press as well as on click.
for (const type of ["pointerdown", "click"]) {
  $("strips").addEventListener(type, (event) => {
    const strip = event.target.closest("[data-callsign]");
    if (strip) select(sim.find(strip.dataset.callsign));
  });
}

canvas.addEventListener("click", (event) => {
  const box = canvas.getBoundingClientRect();
  select(radar.pick(sim, event.clientX - box.left, event.clientY - box.top));
});

$("pause").addEventListener("click", (event) => {
  paused = !paused;
  event.currentTarget.textContent = paused ? "Resume" : "Pause";
  input.focus();
});

document.querySelectorAll("[data-rate]").forEach((button) => {
  button.addEventListener("click", () => {
    rate = Number(button.dataset.rate);
    document.querySelectorAll("[data-rate]").forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
    input.focus();
  });
});

$("restart").addEventListener("click", () => {
  newGame();
  input.focus();
});

function toggleHelp(force) {
  const help = $("help");
  const open = force ?? help.hidden;
  help.hidden = !open;
  $("help-toggle").setAttribute("aria-expanded", String(open));
}

$("help-toggle").addEventListener("click", () => toggleHelp());

new ResizeObserver(() => radar.resize()).observe(canvas);

newGame();
input.focus();
setInterval(tick, 250);
requestAnimationFrame(frame);
