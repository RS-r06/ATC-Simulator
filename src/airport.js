// The airspace. The airport, runway and fix names are made up.

export const AIRPORT = {
  name: "Example Airport",
  code: "XMPL",
  // Radius of the radar sector in nm. Aircraft that cross it leave our control.
  radius: 40,
  runway: {
    name: "27",
    heading: 270,
    // Aircraft land and take off towards the west, starting at the east end.
    threshold: { x: 0.8, y: 0 },
    end: { x: -0.8, y: 0 },
  },
  // Arrivals enter at the corners. Departures leave by the four compass fixes.
  fixes: {
    NOLDA: { x: 0, y: 40, role: "exit" },
    ESTAR: { x: 40, y: 0, role: "exit" },
    SOBEK: { x: 0, y: -40, role: "exit" },
    WENDY: { x: -40, y: 0, role: "exit" },
    MIRAX: { x: 28, y: 28, role: "entry" },
    TOREN: { x: 28, y: -28, role: "entry" },
    VELKA: { x: -28, y: 28, role: "entry" },
    DUNOR: { x: -28, y: -28, role: "entry" },
    // On the extended centre line, 12 nm out. A handy point to send arrivals to.
    KILNO: { x: 12.8, y: 0, role: "approach" },
  },
};

// Separation the controller must keep between airborne aircraft.
export const SEPARATION = { lateralNm: 3, verticalFt: 1000 };

// Aircraft below this height are near the runway and treated as the tower's
// problem, so they are left out of separation checks.
export const RADAR_FLOOR_FT = 1000;

// Lowest altitude the controller may assign, and the highest.
export const MIN_ALTITUDE = 2000;
export const MAX_ALTITUDE = 15000;

// A 3 degree glide slope descends about 318 ft per nm.
export const GLIDESLOPE_FT_PER_NM = 318;
