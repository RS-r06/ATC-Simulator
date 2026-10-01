// Turns a typed instruction into a list of actions.
//
//   BAW12 H270 A40 S210     heading 270, altitude 4000 ft, speed 210 kt
//   BAW12 L090              turn left onto heading 090
//   BAW12 D KILNO ILS       direct to KILNO, cleared for the ILS
//   SAA301 T A50            cleared for takeoff, climb to 5000 ft
//
// Parsing only checks the shape of the command. Whether it makes sense for
// that aircraft (speed limits, runway free) is checked by the simulation.

export function parseCommand(text) {
  const tokens = text.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { error: "Type a callsign and an instruction." };
  const [callsign, ...rest] = tokens;
  if (rest.length === 0) return { callsign, error: `No instruction for ${callsign}.` };

  const actions = [];
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    let m;
    if ((m = token.match(/^([HLR])(\d{1,3})$/))) {
      const value = Number(m[2]);
      if (value < 1 || value > 360) return { callsign, error: `Heading ${m[2]} is not between 001 and 360.` };
      actions.push({ type: "heading", value: value % 360, turn: m[1] === "H" ? null : m[1] });
    } else if ((m = token.match(/^[AC](\d{1,3})$/))) {
      actions.push({ type: "altitude", value: Number(m[1]) * 100 });
    } else if ((m = token.match(/^S(\d{2,3})$/))) {
      actions.push({ type: "speed", value: Number(m[1]) });
    } else if (token === "ILS" || token === "I") {
      actions.push({ type: "ils" });
    } else if (token === "T" || token === "TO") {
      actions.push({ type: "takeoff" });
    } else if (token === "D") {
      const fix = rest[i + 1];
      if (!fix) return { callsign, error: "D needs a fix name after it, like D KILNO." };
      actions.push({ type: "direct", fix });
      i++;
    } else if ((m = token.match(/^D([A-Z]{3,5})$/))) {
      actions.push({ type: "direct", fix: m[1] });
    } else {
      return { callsign, error: `I do not understand "${token}". Type HELP for the command list.` };
    }
  }
  return { callsign, actions };
}
