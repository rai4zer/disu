/**
 * The Equal Earth projection, for placing points on the generated world map.
 *
 * Kept beside `world-map-paths.ts` and using the same constants because a
 * marker projected with different maths than the coastlines is a marker in the
 * wrong place — Tokyo two hundred kilometres out to sea. There is exactly one
 * projection in this codebase and both the paths and the pins go through it.
 *
 * Reference: Šavrič, Patterson & Jenny (2018), "The Equal Earth map
 * projection". Equal-area, so continents keep their true relative size.
 */

import { MAP_HEIGHT, MAP_WIDTH } from "./world-map-paths";

const A1 = 1.340264;
const A2 = -0.081106;
const A3 = 0.000893;
const A4 = 0.003796;
const SQRT3_2 = Math.sqrt(3) / 2;

/** Scale factor shared with the generator: half the map width per x unit at the equator. */
const SCALE = MAP_WIDTH / (2 * rawEqualEarth(180, 0).x);

function rawEqualEarth(lon: number, lat: number): { x: number; y: number } {
  const lambda = (lon * Math.PI) / 180;
  const phi = (lat * Math.PI) / 180;
  const theta = Math.asin(SQRT3_2 * Math.sin(phi));
  const t2 = theta * theta;
  const t6 = t2 * t2 * t2;
  const t8 = t6 * t2;
  return {
    x: (2 * Math.sqrt(3) * lambda * Math.cos(theta)) / (3 * (9 * A4 * t8 + 7 * A3 * t6 + 3 * A2 * t2 + A1)),
    y: A4 * t8 * theta + A3 * t6 * theta + A2 * t2 * theta + A1 * theta
  };
}

/** A latitude/longitude in the map's own SVG user units (0,0 top-left). */
export function projectToMap(lat: number, lon: number): { x: number; y: number } {
  const { x, y } = rawEqualEarth(lon, lat);
  return { x: x * SCALE + MAP_WIDTH / 2, y: MAP_HEIGHT / 2 - y * SCALE };
}

export { MAP_HEIGHT, MAP_WIDTH };
