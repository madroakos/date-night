export type LevelId = "continent" | "country" | "state" | "city" | "district" | "street";

export interface LevelConfig {
  id: LevelId;
  label: string;
  prompt: string;
  targetName: string;
}

export interface DestinationConfig {
  id: string;
  name: string;
  shortName?: string;
  coordinates: [number, number];
  mapZoom?: number;
  icon?: string;
  markerMessage?: string;
  invitation: {
    eyebrow?: string;
    title: string;
    message: string;
    dateTime?: string;
    meetingInstructions?: string;
    dressHint?: string;
    acceptLabel?: string;
    secondaryLabel?: string;
    acceptedMessage?: string;
  };
}

export const LEVELS: LevelConfig[] = [
  {
    id: "continent",
    label: "Földrész",
    prompt: "Melyik földrész?",
    targetName: "Europe",
  },
  {
    id: "country",
    label: "Ország",
    prompt: "Melyik ország?",
    targetName: "Hungary",
  },
  {
    id: "state",
    label: "Megye",
    prompt: "Melyik megye?",
    targetName: "Pest",
  },
  {
    id: "city",
    label: "Város",
    prompt: "Melyik város?",
    targetName: "Budapest",
  },
  {
    id: "district",
    label: "Kerület",
    prompt: "Melyik kerület?",
    targetName: "VI. kerület",
  },
  {
    id: "street",
    label: "Utca",
    prompt: "Melyik utca?",
    targetName: "Nagymező utca",
  },
];

/**
 * The complete finale is configured here. To use another endpoint, replace
 * this object and update the answer chain above; the map and invitation UI do
 * not contain destination-specific copy.
 */
export const DESTINATION: DestinationConfig = {
  id: "tereza-restaurant",
  name: "Tereza étterem",
  shortName: "Tereza",
  coordinates: [19.061686, 47.5026769],
  mapZoom: 18,
  icon: "🌮",
  markerMessage: "Itt fogsz zabálni",
  invitation: {
    eyebrow: "Megtaláltad a célpontot",
    title: "Találkozzunk a Terezában 💛",
    message: "Taco Tuesday lesz!",
    dateTime: "2026. szeptember 29., 19:00",
    meetingInstructions: "1065 Budapest, Nagymező utca 3.",
    dressHint: "Valami elegáns, amiben jól érzed magad.",
    acceptLabel: "Elfogadom 💛",
    secondaryLabel: "Megnézem a térképen",
    acceptedMessage: "",
  },
};

/**
 * The date night itself, in Hungarian time. September 2026 is CEST (UTC+2),
 * so the fixed offset makes the parsed timestamp exact and timezone-proof.
 */
export const DATE_NIGHT_END_MS = new Date("2026-09-29T19:00:00+02:00").getTime();

/** How long before date night the final street round becomes available. */
export const STREET_UNLOCK_LEAD_MS = 4 * 60 * 60 * 1000;

/**
 * Master switch for the timed layer unlocks. Set to true to re-enable the
 * 4-hour street-round guard anchored to DATE_NIGHT_END_MS; while false every
 * layer is available immediately and no cooldown UI (countdown, centered
 * header, darkened globe) appears.
 */
export const LAYER_COOLDOWN_ENABLED = true;

/**
 * Unlock timestamp for a level index, or null when the layer is available
 * immediately. Only the final street round has a scheduled unlock.
 */
export function unlockTimeForIndex(index: number): number | null {
  // All earlier rounds stay open; only the final street guess is time-gated.
  if (!LAYER_COOLDOWN_ENABLED || LEVELS[index]?.id !== "street") return null;
  return DATE_NIGHT_END_MS - STREET_UNLOCK_LEAD_MS;
}

export function isUnlocked(index: number, now: number = Date.now()): boolean {
  const unlockAt = unlockTimeForIndex(index);
  return unlockAt === null || now >= unlockAt;
}

export function formatCountdown(msRemaining: number): string {
  const totalSeconds = Math.max(0, Math.ceil(msRemaining / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}
