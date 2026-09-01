// Canonical XP -> level/medal progression. XP is the authoritative value;
// level and medal are always derived. Students.level / Students.medal are dead
// columns (every production row reads 1 regardless of XP) and must never be
// used as a source of truth.
//
// Kept byte-identical in behaviour to client/src/utils/LevelCalculator.ts:
// XP required to reach level N from N-1 = 10 + 3 * (N - 1).

export const calculateLevel = (totalXp: number) => {
  const baseXp = 10;
  const increment = 3;
  let remaining = Math.max(0, Math.floor(Number(totalXp) || 0));
  let level = 1;
  let xpForNextLevel = baseXp;

  while (remaining >= xpForNextLevel) {
    remaining -= xpForNextLevel;
    level++;
    xpForNextLevel = baseXp + increment * (level - 1);
  }
  return { level, remainingXp: remaining, xpForNextLevel };
};

// Medal milestones from the SRS gamification appendix.
const MEDAL_THRESHOLDS = [200, 150, 100, 75, 50, 25, 10, 5];

/** Highest medal tier earned for a level, or 0 when none reached yet. */
export const calculateMedal = (level: number): number => {
  const reached = MEDAL_THRESHOLDS.filter((threshold) => level >= threshold);
  return reached.length > 0 ? Math.max(...reached) : 0;
};
