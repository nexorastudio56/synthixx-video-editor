/** Visual Memory & Novelty Scorer: keeps a 20-minute video from falling into repetitive templates. */
export interface VisualMemory { usedArchetypes: string[]; previousCameraAngles: string[]; dominantColors: string[]; recurring: Record<string, string> }
export const newMemory = (): VisualMemory => ({ usedArchetypes: [], previousCameraAngles: [], dominantColors: [], recurring: {} });
/** higher = more novel. Recent repeats are punished hard, long-ago repeats lightly. */
export function novelty(list: string[], cand: string, window = 4): number {
  let s = 1; const recent = list.slice(-window);
  recent.forEach((u, i) => { if (u === cand) s -= 0.9 * ((i + 1) / recent.length); });
  s -= 0.04 * list.filter(u => u === cand).length;
  return +s.toFixed(3);
}
export function pickMostNovel<T extends string>(cands: T[], used: string[]): { pick: T; score: number; scores: Record<string, number> } {
  const scores: Record<string, number> = {}; cands.forEach((c, i) => { scores[c] = +(novelty(used, c) - i * 0.02).toFixed(3); });
  const pick = cands.reduce((a, b) => (scores[b] > scores[a] ? b : a)); return { pick, score: scores[pick], scores };
}
export const CAMERA_PRESETS = ["push_in", "pull_out", "pan_left", "pan_right", "tilt_up", "tilt_down", "focus_pull", "drift"] as const;
export type CameraPreset = typeof CAMERA_PRESETS[number];
