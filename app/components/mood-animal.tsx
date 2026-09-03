"use client";

/**
 * The sentiment mascots: a bear, a dog and a bull, each walking in place.
 *
 * Three constraints shaped these, in this order:
 *
 * 1. **They must read as the animal at 64px.** The previous figures were built
 *    from circles and line segments and, at the size they actually render,
 *    the bull and the crab were the same grey blob. So each animal here is one
 *    filled silhouette path with the profile that identifies it — the bear's
 *    shoulder hump and round ear, the dog's upright ear and raised tail, the
 *    bull's horns and heavy neck — rather than a head, a body and four sticks.
 *
 * 2. **The walk must be a walk.** Quadrupeds do not move their legs in pairs at
 *    random; a walking gait is four-beat, each foot landing a quarter cycle
 *    after the one before it, in the order near-hind, near-fore, off-hind,
 *    off-fore. That order is what the `--phase` values below encode, and it is
 *    the single thing that makes the motion read as walking rather than as a
 *    toy waving its legs. Each leg is two segments — an upper that swings from
 *    the shoulder and a lower that trails it slightly — because a rigid leg
 *    reads as a pendulum no matter how well timed it is.
 *
 * 3. **Walking in place.** The body never translates horizontally. It rises and
 *    falls twice per cycle (the two-beat bob every four-beat gait produces) and
 *    the far-side legs are drawn dimmer so the four legs read as two pairs in
 *    depth rather than four legs in a row.
 *
 * Colour comes from `currentColor` throughout, so the caller tints the whole
 * figure by setting `color` — the sentiment card gives the bear its red and the
 * bull its green without this component knowing anything about sentiment.
 */

import styles from "./mood-animal.module.css";

export type Mood = "positive" | "neutral" | "negative";

type LegProps = {
  /** Where the leg hangs from, in viewBox units. */
  x: number;
  y: number;
  /** Quarter-cycle offset: the four-beat walk order. */
  phase: 0 | 0.25 | 0.5 | 0.75;
  /** Far-side legs are dimmed so the pairs read in depth. */
  far?: boolean;
  /** Upper and lower segment lengths. */
  upper: number;
  lower: number;
  /** Stroke weight — a bull's leg is thicker than a dog's. */
  weight: number;
};

/**
 * One articulated leg.
 *
 * The nesting is what does the work: the outer group swings the whole leg from
 * the shoulder, and the inner group — translated down to the knee — bends the
 * lower segment on the same cycle but a beat behind. That lag is the difference
 * between a leg that walks and a leg that swings.
 */
function Leg({ x, y, phase, far, upper, lower, weight }: LegProps) {
  return (
    <g
      className={`${styles.leg} ${far ? styles.legFar : ""}`}
      style={{ "--phase": phase } as React.CSSProperties}
      transform={`translate(${x} ${y})`}
    >
      <g className={styles.legUpper}>
        <line x1="0" y1="0" x2="0" y2={upper} strokeWidth={weight} strokeLinecap="round" />
        <g className={styles.legLower} transform={`translate(0 ${upper})`}>
          <line x1="0" y1="0" x2="0" y2={lower} strokeWidth={weight * 0.86} strokeLinecap="round" />
          {/* The foot. Small, but its absence is what makes a leg look like a stick. */}
          <line
            x1="-1"
            y1={lower}
            x2={weight * 0.9}
            y2={lower}
            strokeWidth={weight * 0.8}
            strokeLinecap="round"
          />
        </g>
      </g>
    </g>
  );
}

/** The four-beat walk order, shared by all three animals. */
const GAIT: Array<LegProps["phase"]> = [0, 0.5, 0.25, 0.75];

function Bear() {
  return (
    <g className={styles.bodyGroup}>
      {/* Far pair first, so the near legs overlap them. */}
      <Leg x={25} y={40} phase={GAIT[2]} far upper={9} lower={8} weight={4.6} />
      <Leg x={52} y={40} phase={GAIT[3]} far upper={9} lower={8} weight={4.6} />

      <g className={styles.torso}>
        {/*
          One silhouette: rump, the shoulder hump that says "bear", a low-slung
          neck, a blunt muzzle, and back along the belly. The hump is the single
          most identifying line on the animal, so it is the tallest point.
        */}
        <path
          d="M20 42
             C16 42 14 36 15 31
             C16 25 20 21 27 20
             C31 15 38 14 44 16
             C50 13 57 15 60 20
             C64 22 67 25 68 29
             C69 32 67 34 64 34
             L60 33
             C58 36 56 38 52 39
             L46 40
             C40 42 30 43 20 42 Z"
        />
        {/* Ear — small and round, set well back. Nothing else on the head is
            allowed to compete with it at this size. */}
        <circle cx="55" cy="17" r="4.2" />
        {/* Muzzle and eye, cut back out of the silhouette. */}
        <circle className={styles.cut} cx="63" cy="27" r="1.5" />
        <circle className={styles.eye} cx="60" cy="23" r="1.4" />
        {/* Stub tail. */}
        <circle cx="17" cy="34" r="3" />
      </g>

      <Leg x={22} y={40} phase={GAIT[0]} upper={9} lower={8} weight={5} />
      <Leg x={49} y={40} phase={GAIT[1]} upper={9} lower={8} weight={5} />
    </g>
  );
}

function Dog() {
  return (
    <g className={styles.bodyGroup}>
      <Leg x={27} y={39} phase={GAIT[2]} far upper={10} lower={9} weight={3.4} />
      <Leg x={53} y={39} phase={GAIT[3]} far upper={10} lower={9} weight={3.4} />

      <g className={styles.torso}>
        {/*
          Leaner than the bear, with a tucked waist and a chest that drops in
          front — the profile of a working dog rather than a barrel.
        */}
        <path
          d="M22 38
             C19 37 18 33 20 30
             C22 26 27 24 33 24
             L46 24
             C50 21 55 20 59 21
             L62 22
             C66 23 68 26 68 29
             C68 32 66 33 63 33
             L59 32
             C57 35 54 37 50 37
             L36 38
             C31 39 26 39 22 38 Z"
        />
        {/* Upright triangular ear — the dog's counterpart to the bear's round one. */}
        <path d="M56 21 L54 12 L62 18 Z" />
        {/* Muzzle, drawn forward of the head mass. */}
        <path d="M66 28 L73 29 L72 32 L65 32 Z" />
        <circle className={styles.eye} cx="61" cy="26" r="1.3" />
        {/* The tail wags on its own cycle — the one piece of motion that is the
            dog's alone, and the reason a neutral reading still looks friendly. */}
        <path className={styles.tail} d="M22 33 C16 31 13 26 14 21" strokeWidth="3.4" strokeLinecap="round" />
      </g>

      <Leg x={24} y={38} phase={GAIT[0]} upper={10} lower={9} weight={3.8} />
      <Leg x={50} y={38} phase={GAIT[1]} upper={10} lower={9} weight={3.8} />
    </g>
  );
}

function Bull() {
  return (
    <g className={styles.bodyGroup}>
      <Leg x={26} y={41} phase={GAIT[2]} far upper={8} lower={8} weight={5} />
      <Leg x={54} y={41} phase={GAIT[3]} far upper={8} lower={8} weight={5} />

      <g className={styles.torso}>
        {/*
          Deep chest, straight back, heavy neck running down into the shoulder —
          the mass sits forward, which is what separates a bull from the bear's
          hump-backed profile.
        */}
        <path
          d="M19 41
             C16 40 15 34 16 29
             C17 24 22 21 29 21
             L48 21
             C52 18 57 17 61 19
             L64 21
             C68 23 69 27 68 31
             C67 34 64 35 61 34
             L58 33
             C56 37 53 39 49 40
             L33 41
             C28 42 22 42 19 41 Z"
        />
        {/* Horns, curving up and out. The one shape doing the identifying. */}
        <path
          className={styles.horn}
          d="M58 19 C56 13 51 11 47 13"
          strokeWidth="2.8"
          strokeLinecap="round"
        />
        <path
          className={styles.horn}
          d="M65 19 C66 12 71 10 74 13"
          strokeWidth="2.8"
          strokeLinecap="round"
        />
        <circle className={styles.eye} cx="61" cy="26" r="1.4" />
        {/* Muzzle. */}
        <path className={styles.cut} d="M65 30 H69" strokeWidth="1.6" strokeLinecap="round" />
        {/* Tufted tail. */}
        <path className={styles.tail} d="M18 32 C13 33 11 37 12 42" strokeWidth="2.6" strokeLinecap="round" />
      </g>

      <Leg x={23} y={41} phase={GAIT[0]} upper={8} lower={8} weight={5.4} />
      <Leg x={51} y={41} phase={GAIT[1]} upper={8} lower={8} weight={5.4} />
    </g>
  );
}

/**
 * `mood` is the sentiment vocabulary the rest of the app already speaks, so the
 * caller does not have to know which animal stands for which reading.
 */
export default function MoodAnimal({ mood, className }: { mood: Mood; className?: string }) {
  const label = mood === "positive" ? "Bull" : mood === "negative" ? "Bear" : "Dog";

  return (
    <svg
      viewBox="0 0 88 60"
      className={`${styles.figure} ${className ?? ""}`}
      role="img"
      aria-label={label}
    >
      {mood === "positive" ? <Bull /> : mood === "negative" ? <Bear /> : <Dog />}
      {/* The ground shadow. It squashes on the down-beat, which is most of what
          sells "in place" rather than "floating". */}
      <ellipse className={styles.shadow} cx="44" cy="56" rx="24" ry="2.6" />
    </svg>
  );
}
