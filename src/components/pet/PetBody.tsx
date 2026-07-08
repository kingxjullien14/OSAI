/** The pet's BODY — the fresh design (P1, living-cockpit; owner: "a fresh new
 *  design. maybe an even better design").
 *
 *  Concept: a little GLASS SPIRIT — the creature is made of the app's own
 *  material. A translucent Neon Glass blob with a glowing accent core, big
 *  expressive eyes (the emotion channel), stubby feet, and squash-and-stretch
 *  life. Accent-driven (tokens + color-mix only — the component ratchet bans
 *  hex), so it re-tints with the owner's theme automatically.
 *
 *  Pure presentation: mood/activity/stage/flavor come from the soul (P0) via
 *  props; every animation is a CSS keyframe in App.css (reduced-motion safe).
 *  The rig is ONE svg so it scales from the 56px desk creature to a
 *  room-sized portrait without redrawing. */
import type { PetActivityState, PetMood, PetStage, PetSurface } from "../../lib/pet/engine";

/** Transient reactions the overlay can play over the steady activity. */
export type PetPose = PetActivityState | "held" | "tossed" | "land";

export function PetBody({
  size = 64,
  mood,
  pose,
  stage,
  flavor,
  facing = 1,
}: {
  size?: number;
  mood: PetMood;
  pose: PetPose;
  stage: PetStage;
  flavor: PetSurface | null;
  /** 1 = facing right, -1 = facing left (walk direction). */
  facing?: 1 | -1;
}) {
  const asleep = pose === "sleep";
  const eyes = asleep ? "closed" : eyeStyle(mood, pose);
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className="osai-pet"
      data-pose={pose}
      data-mood={mood}
      aria-label={`pet — ${mood}${asleep ? ", asleep" : ""}`}
      style={{
        overflow: "visible",
        filter:
          "drop-shadow(0 0 10px color-mix(in srgb, var(--color-accent) 45%, transparent))",
      }}
    >
      <defs>
        <radialGradient id="osaiPetCore" cx="50%" cy="40%" r="65%">
          <stop offset="0%" stopColor="color-mix(in srgb, var(--color-accent) 45%, white)" />
          <stop offset="55%" stopColor="var(--color-accent)" />
          <stop offset="100%" stopColor="color-mix(in srgb, var(--color-accent) 55%, black)" />
        </radialGradient>
        <radialGradient id="osaiPetInner" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="color-mix(in srgb, var(--osai-accent-2) 85%, white)" />
          <stop offset="100%" stopColor="color-mix(in srgb, var(--osai-accent-2) 20%, transparent)" />
        </radialGradient>
      </defs>

      {/* ground shadow — squashes with the hop, fades while held/tossed */}
      <ellipse
        className="pet2-shadow"
        cx="50"
        cy="93"
        rx="22"
        ry="4"
        fill="color-mix(in srgb, var(--color-bg) 60%, black)"
        opacity={pose === "held" || pose === "tossed" ? 0.15 : 0.45}
      />

      {/* everything that squashes/hops lives in this group */}
      <g
        className="pet2-rig"
        style={{ transformBox: "fill-box", transformOrigin: "50% 100%" }}
      >
        <g style={{ transformBox: "fill-box", transformOrigin: "center", transform: `scaleX(${facing})` }}>
          {/* feet — tucked while asleep/held */}
          {!asleep && pose !== "held" && pose !== "tossed" && (
            <g className="pet2-feet" fill="color-mix(in srgb, var(--color-accent) 55%, black)">
              <rect className="pet2-foot-l" x="33" y="84" width="11" height="7" rx="3.5" />
              <rect className="pet2-foot-r" x="56" y="84" width="11" height="7" rx="3.5" />
            </g>
          )}

          {/* the glass body */}
          <path
            className="pet2-body"
            d="M16 58 C16 31 31 17 50 17 C69 17 84 31 84 58 C84 78 69 89 50 89 C31 89 16 78 16 58 Z"
            fill="url(#osaiPetCore)"
            opacity="0.92"
          />
          {/* glass rim light */}
          <path
            d="M22 47 C24 32 35 22 50 21"
            fill="none"
            stroke="color-mix(in srgb, white 55%, transparent)"
            strokeWidth="3"
            strokeLinecap="round"
            opacity="0.7"
          />
          {/* the glowing core */}
          <circle className="pet2-core" cx="50" cy="58" r="15" fill="url(#osaiPetInner)" opacity="0.85" />

          {/* cheeks when delighted */}
          {(mood === "happy" || mood === "ecstatic") && !asleep && (
            <g fill="color-mix(in srgb, var(--osai-accent-2) 55%, transparent)">
              <ellipse cx="29" cy="56" rx="5" ry="3" />
              <ellipse cx="71" cy="56" rx="5" ry="3" />
            </g>
          )}

          {/* eyes + mouth */}
          <Eyes style={eyes} />
          <Mouth mood={mood} pose={pose} />

          {/* stage topper */}
          <Topper stage={stage} flavor={flavor} />
        </g>
      </g>

      {/* zzz — only while asleep */}
      {asleep && (
        <g
          className="pet2-zzz"
          fill="var(--osai-accent-2)"
          fontFamily="ui-monospace, monospace"
          fontWeight="bold"
        >
          <text className="pet2-z pet2-z1" x="70" y="34" fontSize="11">z</text>
          <text className="pet2-z pet2-z2" x="79" y="24" fontSize="9">z</text>
          <text className="pet2-z pet2-z3" x="87" y="16" fontSize="7">z</text>
        </g>
      )}
    </svg>
  );
}

type EyeKind = "round" | "crescent" | "star" | "halfLid" | "cross" | "closed" | "wide";

function eyeStyle(mood: PetMood, pose: PetPose): EyeKind {
  if (pose === "startled" || pose === "tossed") return "wide";
  if (pose === "held") return "round";
  switch (mood) {
    case "ecstatic":
      return "star";
    case "happy":
      return "crescent";
    case "sleepy":
      return "halfLid";
    case "grumpy":
      return "halfLid";
    case "sick":
      return "cross";
    default:
      return "round";
  }
}

const PUPIL = "color-mix(in srgb, var(--color-bg) 70%, black)";
const SHINE = "color-mix(in srgb, var(--osai-accent-2) 80%, white)";

function Eyes({ style }: { style: EyeKind }) {
  const stroke = PUPIL;
  if (style === "closed" || style === "crescent") {
    // closed = restful arc down; crescent = happy arc up
    const d = style === "closed" ? "M-7 0 Q0 4 7 0" : "M-7 2 Q0 -6 7 2";
    return (
      <g className="pet2-eyes">
        {[36, 64].map((x) => (
          <path
            key={x}
            d={d}
            transform={`translate(${x} 47)`}
            fill="none"
            stroke={stroke}
            strokeWidth="3.4"
            strokeLinecap="round"
          />
        ))}
      </g>
    );
  }
  if (style === "cross") {
    return (
      <g className="pet2-eyes" stroke={stroke} strokeWidth="3" strokeLinecap="round">
        {[36, 64].map((x) => (
          <g key={x} transform={`translate(${x} 46)`}>
            <path d="M-5 -5 L5 5" />
            <path d="M5 -5 L-5 5" />
          </g>
        ))}
      </g>
    );
  }
  if (style === "star") {
    const star = "M0 -7 L1.8 -1.8 L7 0 L1.8 1.8 L0 7 L-1.8 1.8 L-7 0 L-1.8 -1.8 Z";
    return (
      <g className="pet2-eyes" fill={SHINE}>
        {[36, 64].map((x) => (
          <path key={x} d={star} transform={`translate(${x} 46)`} />
        ))}
      </g>
    );
  }
  const ry = style === "halfLid" ? 3.4 : style === "wide" ? 8.4 : 6.6;
  const cy = style === "halfLid" ? 48.5 : 46;
  return (
    <g className="pet2-eyes">
      {[36, 64].map((x) => (
        <g key={x}>
          <ellipse cx={x} cy={cy} rx={style === "wide" ? 7.4 : 6} ry={ry} fill={PUPIL} />
          <circle cx={x + 2} cy={cy - 2} r="1.8" fill={SHINE} />
        </g>
      ))}
    </g>
  );
}

function Mouth({ mood, pose }: { mood: PetMood; pose: PetPose }) {
  const stroke = PUPIL;
  let d = "M45 63 Q50 66 55 63"; // gentle smile
  if (pose === "eat") d = "M44 61 Q50 70 56 61 Q50 66 44 61"; // open chomp
  else if (pose === "startled" || pose === "tossed") d = "M46 62 Q50 68 54 62 Q50 66 46 62";
  else if (mood === "grumpy") d = "M45 66 Q50 62 55 66";
  else if (mood === "hungry") d = "M44 64 Q47 62 50 64 Q53 66 56 64";
  else if (mood === "sick") d = "M45 65 Q48 63 51 65 Q53 66 55 64";
  else if (mood === "ecstatic") d = "M43 61 Q50 70 57 61";
  const open = pose === "eat" || pose === "startled" || pose === "tossed" || mood === "ecstatic";
  return (
    <path
      className="pet2-mouth"
      d={d}
      fill={open ? "color-mix(in srgb, var(--color-bg) 55%, black)" : "none"}
      stroke={stroke}
      strokeWidth="2.6"
      strokeLinecap="round"
    />
  );
}

/** Stage topper: sprout → leaf nub · adept → flavor emblem · elder → halo. */
function Topper({ stage, flavor }: { stage: PetStage; flavor: PetSurface | null }) {
  if (stage === "hatchling") return null;
  const stemColor = "color-mix(in srgb, var(--color-success) 75%, var(--color-accent))";
  if (stage === "sprout") {
    return (
      <g className="pet2-topper">
        <path d="M50 17 C50 12 50 10 50 8" stroke={stemColor} strokeWidth="2.4" fill="none" strokeLinecap="round" />
        <path d="M50 9 C46 4 40 5 39 9 C43 12 48 12 50 9 Z" fill={stemColor} />
      </g>
    );
  }
  const emblemColor = "var(--osai-accent-2)";
  const emblem = (() => {
    switch (flavor) {
      case "terminal":
        // a blinking cursor block on a stem
        return <rect className="pet2-cursor" x="45.5" y="2" width="9" height="11" rx="2" fill={emblemColor} />;
      case "chat":
        return (
          <path
            d="M42 3 h16 a3 3 0 0 1 3 3 v5 a3 3 0 0 1 -3 3 h-7 l-4 4 v-4 h-5 a3 3 0 0 1 -3 -3 v-5 a3 3 0 0 1 3 -3 Z"
            fill={emblemColor}
          />
        );
      case "browser":
        return (
          <g stroke={emblemColor} fill="none" strokeWidth="2.2">
            <circle cx="50" cy="8" r="6" />
            <ellipse cx="50" cy="8" rx="9.5" ry="3.2" transform="rotate(-18 50 8)" />
          </g>
        );
      case "files":
        return (
          <path d="M43 4 h6 l2.5 3 h8 a1.8 1.8 0 0 1 1.8 1.8 v6 a1.8 1.8 0 0 1 -1.8 1.8 h-16.5 a1.8 1.8 0 0 1 -1.8 -1.8 v-9 a1.8 1.8 0 0 1 1.8 -1.8 Z" fill={emblemColor} />
        );
      case "notes":
        return (
          <path d="M56 2 C48 4 44 9 43 15 C48 14 54 10 56 2 Z M43 15 L41 17" fill={emblemColor} stroke={emblemColor} strokeWidth="1.6" strokeLinecap="round" />
        );
      default:
        // adept/elder without a dominant flavor — a simple crest dot
        return <circle cx="50" cy="8" r="4" fill={emblemColor} />;
    }
  })();
  return (
    <g className="pet2-topper">
      {stage === "elder" && (
        <ellipse
          className="pet2-halo"
          cx="50"
          cy="6"
          rx="15"
          ry="4"
          fill="none"
          stroke="color-mix(in srgb, var(--osai-accent-2) 75%, white)"
          strokeWidth="2.4"
          opacity="0.85"
        />
      )}
      <path d="M50 17 L50 13" stroke="color-mix(in srgb, var(--color-accent) 60%, black)" strokeWidth="2.2" strokeLinecap="round" />
      {emblem}
    </g>
  );
}
