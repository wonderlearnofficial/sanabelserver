import { QueryInterface, Sequelize } from "sequelize";
import { TaskCategory } from "../models/challenge.model"; // Import TaskCategory enum

interface ChallengeData {
  id: number; // Incrementing ID
  title: string; // Represents the milestone level
  description: string; // Description of the challenge
  level: number; // Represents the trophy milestone level
  snabelBlue: number; // Blue rewards
  snabelYellow: number; // Yellow rewards
  snabelRed: number; // Red rewards
  xp: number; // XP rewards
  point: number; // Represents the trophy milestone point
  category: TaskCategory; // Category of the challenge
  taskCategory: string | null; // Foreign key to Task (optional)
  tasktype: string | null; // Foreign key to Task (optional)
  water?: number; // Optional water property
  seeder?: number; // Optional seeder property
}

// Generate challenge data based on configuration
let globalIdCounter = 1; // 🌍 Global counter to ensure unique IDs

const generateChallenges = (
  missionName: string,
  config: {
    blue: number;
    yellow: number;
    red: number;
    xp: number;
    trophyMilestones: number[];
    xpMultiplier: number;
    blueMultiplier: number;
    yellowMultiplier: number;
    redMultiplier: number;
    water?: number;
    seeder?: number;
  },
  category: TaskCategory,
  taskCategory?: string,
  tasktype?: string
): ChallengeData[] => {
  const challenges: ChallengeData[] = [];

  config.trophyMilestones.forEach((milestone, index) => {
    const snabelBlue = Math.ceil(
      config.blue * config.blueMultiplier * milestone
    );
    const snabelYellow = Math.ceil(
      config.yellow * config.yellowMultiplier * milestone
    );
    const snabelRed = Math.ceil(config.red * config.redMultiplier * milestone);
    const xp = Math.ceil(config.xp * config.xpMultiplier * milestone);
    const water = config.water ? Math.ceil((config.water * milestone)/10) : 0;
    const seeder = config.seeder ? Math.ceil((config.seeder * milestone)/10) : 0;
    challenges.push({
      id: globalIdCounter++, // 🔥 Use global counter instead of resetting each time
      title: `${missionName}`,
      description: `Complete ${milestone} tasks to unlock this challenge.`,
      level: index + 1,
      snabelBlue,
      snabelYellow,
      snabelRed,
      xp,
      point: milestone,
      category,
      taskCategory: taskCategory ?? null,
      tasktype: tasktype ?? null,
      water, // Include water in the challenge data
      seeder, // Include seeder in the challenge data
    });
  });

  return challenges;
};
const milestones = {
  treeStage: [2, 3, 4],
  progressTree: [1, 5, 10, 15, 30, 40],
  missionsFinished: [1, 5, 10, 25, 50, 75, 100, 150, 250, 500, 750, 1000],
  totalBluePoints: [5, 10, 25, 50, 100, 250, 500, 1000],
  totalYellowPoints: [5, 10, 25, 50, 100, 250, 500, 1000],
  totalRedPoints: [5, 10, 25, 50, 100, 250, 500, 1000],
  totalMixedPoints: [10, 25, 50, 100, 250, 500, 750, 1000, 2500],
  totalXP: [100, 250, 500, 1000, 2500, 5000, 7500, 10000, 25000],
  totalWaterBought: [5, 10, 25, 50, 75, 100, 150],
  totalFertilizerBought: [5, 10, 25, 50, 75, 100],
};

// Generate all challenge data
const challengeData: ChallengeData[] = [
  ...generateChallenges(
    "العلاقة مع الله",
    {
      blue: 2,
      yellow: 2,
      red: 2,
      xp: 5,
      trophyMilestones: [1, 5, 10, 25, 50, 75, 100, 500, 1000],
      xpMultiplier: 1,
      blueMultiplier: 0.6 * 0.5,
      yellowMultiplier: 0.6 * 0.5,
      redMultiplier: 0.6 * 0.5,
    },
    TaskCategory.task,
    "سنابل الإحسان في العلاقة مع الله"
  ),

  ...generateChallenges(
    "العلاقة مع النفس",
    {
      blue: 2,
      yellow: 1,
      red: 1,
      xp: 5,
      trophyMilestones: [1, 5, 10, 25, 50, 75, 100],
      xpMultiplier: 1,
      blueMultiplier: 0.6 * 0.5,
      yellowMultiplier: 0.3 * 0.5,
      redMultiplier: 0.3 * 0.5,
    },
    TaskCategory.task,
    "سنابل الإحسان في العلاقة مع النفس"
  ),

  ...generateChallenges(
    "العلاقة مع الأسرة والمجتمع",
    {
      blue: 1,
      yellow: 2,
      red: 1,
      xp: 5,
      trophyMilestones: [1, 5, 10, 25, 50, 75, 100],
      xpMultiplier: 1,
      blueMultiplier: 0.3 * 0.5,
      yellowMultiplier: 0.6 * 0.5,
      redMultiplier: 0.3 * 0.5,
    },
    TaskCategory.task,
    "سنابل الإحسان في العلاقة مع الأسرة والمجتمع"
  ),

  ...generateChallenges(
    "العلاقة مع الأرض والكون",
    {
      blue: 1,
      yellow: 1,
      red: 2,
      xp: 5,
      trophyMilestones: [1, 5, 10, 25, 50, 75, 100],
      xpMultiplier: 1,
      blueMultiplier: 0.3 * 0.5,
      yellowMultiplier: 0.3 * 0.5,
      redMultiplier: 0.6 * 0.5,
    },
    TaskCategory.task,
    "سنابل الإحسان في العلاقة مع الأرض والكون"
  ),

  ...generateChallenges(
    "Tree Stage",
    {
      blue: 10,
      yellow: 10,
      red: 10,
      xp: 30,
      trophyMilestones: milestones.treeStage,
      xpMultiplier: 1,
      blueMultiplier: 1,
      yellowMultiplier: 1,
      redMultiplier: 1,
    },
    TaskCategory.treestage,
    "Tree Stage Milestones"
  ),

  ...generateChallenges(
    "Progress Tree",
    {
      blue: 10,
      yellow: 10,
      red: 10,
      xp: 50,
      trophyMilestones: milestones.progressTree,
      xpMultiplier: 1,
      blueMultiplier: 1,
      yellowMultiplier: 1,
      redMultiplier: 1,
    },
    TaskCategory.treelevel,
    "Progress Tree Milestones"
  ),

  ...generateChallenges(
    "Missions Finished",
    {
      blue: 1,
      yellow: 1,
      red: 1,
      xp: 1,
      trophyMilestones: milestones.missionsFinished,
      xpMultiplier: 1,
      blueMultiplier: 1,
      yellowMultiplier: 1,
      redMultiplier: 1,
    },
    TaskCategory.alltask,
    "Missions Finished Milestones"
  ),

  ...generateChallenges(
    "Total Blue Points",
    {
      blue: 1,
      yellow: 0,
      red: 0,
      xp: 0,
      trophyMilestones: milestones.totalBluePoints,
      xpMultiplier: 1,
      blueMultiplier: 1,
      yellowMultiplier: 1,
      redMultiplier: 1,
    },
    TaskCategory.snabelBlue,
    "Total Blue Points Milestones"
  ),

  ...generateChallenges(
    "Total Yellow Points",
    {
      blue: 0,
      yellow: 1,
      red: 0,
      xp: 0,
      trophyMilestones: milestones.totalYellowPoints,
      xpMultiplier: 1,
      blueMultiplier: 1,
      yellowMultiplier: 1,
      redMultiplier: 1,
    },
    TaskCategory.snabelYellow,
    "Total Yellow Points Milestones"
  ),

  ...generateChallenges(
    "Total Red Points",
    {
      blue: 0,
      yellow: 0,
      red: 1,
      xp: 0,
      trophyMilestones: milestones.totalRedPoints,
      xpMultiplier: 1,
      blueMultiplier: 1,
      yellowMultiplier: 1,
      redMultiplier: 1,
    },
    TaskCategory.snabelRed,
    "Total Red Points Milestones"
  ),

  ...generateChallenges(
    "Total Mixed Points",
    {
      blue: 2,
      yellow: 2,
      red: 2,
      xp: 0,
      trophyMilestones: milestones.totalMixedPoints,
      xpMultiplier: 1,
      blueMultiplier: 0.3 * 0.5,
      yellowMultiplier: 0.3 * 0.5,
      redMultiplier: 0.6 * 0.5,
    },
    TaskCategory.snabelMixed,
    "Total Mixed Points Milestones"
  ),

  ...generateChallenges(
    "Total XP",
    {
      blue: 0,
      yellow: 0,
      red: 0,
      xp: 20,
      trophyMilestones: milestones.totalXP,
      xpMultiplier: 1,
      blueMultiplier: 0.3 * 0.5,
      yellowMultiplier: 0.3 * 0.5,
      redMultiplier: 0.6 * 0.5,
    },
    TaskCategory.xp,
    "Total XP Milestones"
  ),

  ...generateChallenges(
    "Total Water Bought",
    {
      blue: 0,
      yellow: 0,
      red: 0,
      xp: 0,
      water: 1,
      trophyMilestones: milestones.totalWaterBought,
      // math.ceil / 10  ->>>>  5 water / 10 = 0.5 , math.ceil(0.5) = 1
      xpMultiplier: 1,
      blueMultiplier: 1,
      yellowMultiplier: 1,
      redMultiplier: 1,
    },
    TaskCategory.water,
    "Total Water Bought Milestones"
  ),

  ...generateChallenges(
    "Total Fertilizer Bought",
    {
      blue: 0,
      yellow: 0,
      red: 0,
      xp: 0,
      seeder: 1,
      trophyMilestones: milestones.totalFertilizerBought,
      // math.ceil / 15  ->>>>  5 fertilzer / 15 = 0.5 , math.ceil(0.5) = 1
      xpMultiplier: 1,
      blueMultiplier: 1,
      yellowMultiplier: 1,
      redMultiplier: 1,
    },
    TaskCategory.seeder,
    "Total Fertilizer Bought Milestones"
  ),

  // New challenges for each task type
  ...generateChallenges(
    "الصلاة",
    {
      blue: 2,
      yellow: 2,
      red: 2,
      xp: 5,
      trophyMilestones: [1, 5, 10, 25, 50, 75, 100, 150, 250, 500, 750, 1000],
      xpMultiplier: 1,
      blueMultiplier: 0.6 * 0.5,
      yellowMultiplier: 0.6 * 0.5,
      redMultiplier: 0.6 * 0.5,
    },
    TaskCategory.tasktype,
    undefined,
    "الصلاة"
  ),

  ...generateChallenges(
    "الصيام",
    {
      blue: 2,
      yellow: 2,
      red: 2,
      xp: 5,
      trophyMilestones: [1, 5, 10, 25, 50, 75, 100],
      xpMultiplier: 1,
      blueMultiplier: 0.6 * 0.5,
      yellowMultiplier: 0.6 * 0.5,
      redMultiplier: 0.6 * 0.5,
    },
    TaskCategory.tasktype,
    undefined,
    "الصيام"
  ),

  ...generateChallenges(
    "الصدقة",
    {
      blue: 2,
      yellow: 2,
      red: 2,
      xp: 5,
      trophyMilestones: [1, 5, 10, 25, 50, 75, 100],
      xpMultiplier: 1,
      blueMultiplier: 0.6 * 0.5,
      yellowMultiplier: 0.6 * 0.5,
      redMultiplier: 0.6 * 0.5,
    },
    TaskCategory.tasktype,
    undefined,
    "الصدقة"
  ),

  ...generateChallenges(
    "العفو والصفح",
    {
      blue: 2,
      yellow: 2,
      red: 2,
      xp: 5,
      trophyMilestones: [1, 5, 10, 25, 50, 75, 100],
      xpMultiplier: 1,
      blueMultiplier: 0.6 * 0.5,
      yellowMultiplier: 0.6 * 0.5,
      redMultiplier: 0.6 * 0.5,
    },
    TaskCategory.tasktype,
    undefined,
    "العفو والصفح"
  ),

  ...generateChallenges(
    "الشكر",
    {
      blue: 2,
      yellow: 2,
      red: 2,
      xp: 5,
      trophyMilestones: [1, 5, 10, 25, 50, 75, 100],
      xpMultiplier: 1,
      blueMultiplier: 0.6 * 0.5,
      yellowMultiplier: 0.6 * 0.5,
      redMultiplier: 0.6 * 0.5,
    },
    TaskCategory.tasktype,
    undefined,
    "الشكر"
  ),

  ...generateChallenges(
    "الصبر",
    {
      blue: 2,
      yellow: 2,
      red: 2,
      xp: 5,
      trophyMilestones: [1, 5, 10, 25, 50, 75, 100],
      xpMultiplier: 1,
      blueMultiplier: 0.6 * 0.5,
      yellowMultiplier: 0.6 * 0.5,
      redMultiplier: 0.6 * 0.5,
    },
    TaskCategory.tasktype,
    undefined,
    "الصبر"
  ),

  ...generateChallenges(
    "الذكر",
    {
      blue: 2,
      yellow: 2,
      red: 2,
      xp: 5,
      trophyMilestones: [1, 5, 10, 25, 50, 75, 100],
      xpMultiplier: 1,
      blueMultiplier: 0.6 * 0.5,
      yellowMultiplier: 0.6 * 0.5,
      redMultiplier: 0.6 * 0.5,
    },
    TaskCategory.tasktype,
    undefined,
    "الذكر"
  ),

  ...generateChallenges(
    "الدعاء",
    {
      blue: 2,
      yellow: 2,
      red: 2,
      xp: 5,
      trophyMilestones: [1, 5, 10, 25, 50, 75, 100],
      xpMultiplier: 1,
      blueMultiplier: 0.6 * 0.5,
      yellowMultiplier: 0.6 * 0.5,
      redMultiplier: 0.6 * 0.5,
    },
    TaskCategory.tasktype,
    undefined,
    "الدعاء"
  ),

  ...generateChallenges(
    "الإحسان للجسد",
    {
      blue: 2,
      yellow: 1,
      red: 1,
      xp: 5,
      trophyMilestones: [1, 5, 10, 25, 50, 75, 100],
      xpMultiplier: 1,
      blueMultiplier: 0.6 * 0.5,
      yellowMultiplier: 0.3 * 0.5,
      redMultiplier: 0.3 * 0.5,
    },
    TaskCategory.tasktype,
    undefined,
    "الإحسان للجسد"
  ),

  ...generateChallenges(
    "الإحسان للعقل",
    {
      blue: 2,
      yellow: 1,
      red: 1,
      xp: 5,
      trophyMilestones: [1, 5, 10, 25, 50, 75, 100],
      xpMultiplier: 1,
      blueMultiplier: 0.6 * 0.5,
      yellowMultiplier: 0.3 * 0.5,
      redMultiplier: 0.3 * 0.5,
    },
    TaskCategory.tasktype,
    undefined,
    "الإحسان للعقل"
  ),

  ...generateChallenges(
    "الإحسان للروح",
    {
      blue: 2,
      yellow: 1,
      red: 1,
      xp: 5,
      trophyMilestones: [1, 5, 10, 25, 50, 75, 100],
      xpMultiplier: 1,
      blueMultiplier: 0.6 * 0.5,
      yellowMultiplier: 0.3 * 0.5,
      redMultiplier: 0.3 * 0.5,
    },
    TaskCategory.tasktype,
    undefined,
    "الإحسان للروح"
  ),

  ...generateChallenges(
    "الإحسان للقلب",
    {
      blue: 2,
      yellow: 1,
      red: 1,
      xp: 5,
      trophyMilestones: [1, 5, 10, 25, 50, 75, 100],
      xpMultiplier: 1,
      blueMultiplier: 0.6 * 0.5,
      yellowMultiplier: 0.3 * 0.5,
      redMultiplier: 0.3 * 0.5,
    },
    TaskCategory.tasktype,
    undefined,
    "الإحسان للقلب"
  ),

  ...generateChallenges(
    "بر الوالدين",
    {
      blue: 1,
      yellow: 2,
      red: 1,
      xp: 5,
      trophyMilestones: [1, 5, 10, 25, 50, 75, 100],
      xpMultiplier: 1,
      blueMultiplier: 0.3 * 0.5,
      yellowMultiplier: 0.6 * 0.5,
      redMultiplier: 0.3 * 0.5,
    },
    TaskCategory.tasktype,
    undefined,
    "بر الوالدين"
  ),

  ...generateChallenges(
    "صلة الرحم",
    {
      blue: 1,
      yellow: 2,
      red: 1,
      xp: 5,
      trophyMilestones: [1, 5, 10, 25, 50, 75, 100],
      xpMultiplier: 1,
      blueMultiplier: 0.3 * 0.5,
      yellowMultiplier: 0.6 * 0.5,
      redMultiplier: 0.3 * 0.5,
    },
    TaskCategory.tasktype,
    undefined,
    "صلة الرحم"
  ),

  ...generateChallenges(
    "الصدق والأمانة",
    {
      blue: 1,
      yellow: 2,
      red: 1,
      xp: 5,
      trophyMilestones: [1, 5, 10, 25, 50, 75, 100],
      xpMultiplier: 1,
      blueMultiplier: 0.3 * 0.5,
      yellowMultiplier: 0.6 * 0.5,
      redMultiplier: 0.3 * 0.5,
    },
    TaskCategory.tasktype,
    undefined,
    "الصدق والأمانة"
  ),

  ...generateChallenges(
    "إكرام الضيف",
    {
      blue: 1,
      yellow: 2,
      red: 1,
      xp: 5,
      trophyMilestones: [1, 5, 10, 25, 50, 75, 100],
      xpMultiplier: 1,
      blueMultiplier: 0.3 * 0.5,
      yellowMultiplier: 0.6 * 0.5,
      redMultiplier: 0.3 * 0.5,
    },
    TaskCategory.tasktype,
    undefined,
    "إكرام الضيف"
  ),

  ...generateChallenges(
    "الإحسان للجار",
    {
      blue: 1,
      yellow: 2,
      red: 1,
      xp: 5,
      trophyMilestones: [1, 5, 10, 25, 50, 75, 100],
      xpMultiplier: 1,
      blueMultiplier: 0.3 * 0.5,
      yellowMultiplier: 0.6 * 0.5,
      redMultiplier: 0.3 * 0.5,
    },
    TaskCategory.tasktype,
    undefined,
    "الإحسان للجار"
  ),

  ...generateChallenges(
    "توقير الكبير ورحمة الصغير",
    {
      blue: 1,
      yellow: 2,
      red: 1,
      xp: 5,
      trophyMilestones: [1, 5, 10, 25, 50, 75, 100],
      xpMultiplier: 1,
      blueMultiplier: 0.3 * 0.5,
      yellowMultiplier: 0.6 * 0.5,
      redMultiplier: 0.3 * 0.5,
    },
    TaskCategory.tasktype,
    undefined,
    "توقير الكبير ورحمة الصغير"
  ),

  ...generateChallenges(
    "التهادي",
    {
      blue: 1,
      yellow: 2,
      red: 1,
      xp: 5,
      trophyMilestones: [1, 5, 10, 25, 50, 75, 100],
      xpMultiplier: 1,
      blueMultiplier: 0.3 * 0.5,
      yellowMultiplier: 0.6 * 0.5,
      redMultiplier: 0.3 * 0.5,
    },
    TaskCategory.tasktype,
    undefined,
    "التهادي"
  ),

  ...generateChallenges(
    "الإطعام",
    {
      blue: 1,
      yellow: 2,
      red: 1,
      xp: 5,
      trophyMilestones: [1, 5, 10, 25, 50, 75, 100],
      xpMultiplier: 1,
      blueMultiplier: 0.3 * 0.5,
      yellowMultiplier: 0.6 * 0.5,
      redMultiplier: 0.3 * 0.5,
    },
    TaskCategory.tasktype,
    undefined,
    "الإطعام"
  ),

  ...generateChallenges(
    "الرحمة والرفق",
    {
      blue: 1,
      yellow: 2,
      red: 1,
      xp: 5,
      trophyMilestones: [1, 5, 10, 25, 50, 75, 100],
      xpMultiplier: 1,
      blueMultiplier: 0.3 * 0.5,
      yellowMultiplier: 0.6 * 0.5,
      redMultiplier: 0.3 * 0.5,
    },
    TaskCategory.tasktype,
    undefined,
    "الرحمة والرفق"
  ),

  ...generateChallenges(
    "الوفاء والامتنان",
    {
      blue: 1,
      yellow: 2,
      red: 1,
      xp: 5,
      trophyMilestones: [1, 5, 10, 25, 50, 75, 100],
      xpMultiplier: 1,
      blueMultiplier: 0.3 * 0.5,
      yellowMultiplier: 0.6 * 0.5,
      redMultiplier: 0.3 * 0.5,
    },
    TaskCategory.tasktype,
    undefined,
    "الوفاء والامتنان"
  ),

  ...generateChallenges(
    "إدخال السرور",
    {
      blue: 1,
      yellow: 2,
      red: 1,
      xp: 5,
      trophyMilestones: [1, 5, 10, 25, 50, 75, 100],
      xpMultiplier: 1,
      blueMultiplier: 0.3 * 0.5,
      yellowMultiplier: 0.6 * 0.5,
      redMultiplier: 0.3 * 0.5,
    },
    TaskCategory.tasktype,
    undefined,
    "إدخال السرور"
  ),

  ...generateChallenges(
    "إيناس الوحشان وترك التناجي",
    {
      blue: 1,
      yellow: 2,
      red: 1,
      xp: 5,
      trophyMilestones: [1, 5, 10, 25, 50, 75, 100],
      xpMultiplier: 1,
      blueMultiplier: 0.3 * 0.5,
      yellowMultiplier: 0.6 * 0.5,
      redMultiplier: 0.3 * 0.5,
    },
    TaskCategory.tasktype,
    undefined,
    "إيناس الوحشان وترك التناجي"
  ),

  ...generateChallenges(
    "الإصلاح بين متخاصمين",
    {
      blue: 1,
      yellow: 2,
      red: 1,
      xp: 5,
      trophyMilestones: [1, 5, 10, 25, 50, 75, 100],
      xpMultiplier: 1,
      blueMultiplier: 0.3 * 0.5,
      yellowMultiplier: 0.6 * 0.5,
      redMultiplier: 0.3 * 0.5,
    },
    TaskCategory.tasktype,
    undefined,
    "الإصلاح بين متخاصمين"
  ),

  ...generateChallenges(
    "التبسم وإفشاء السلام",
    {
      blue: 1,
      yellow: 2,
      red: 1,
      xp: 5,
      trophyMilestones: [1, 5, 10, 25, 50, 75, 100],
      xpMultiplier: 1,
      blueMultiplier: 0.3 * 0.5,
      yellowMultiplier: 0.6 * 0.5,
      redMultiplier: 0.3 * 0.5,
    },
    TaskCategory.tasktype,
    undefined,
    "التبسم وإفشاء السلام"
  ),

  ...generateChallenges(
    "إماطة الأذى عن الطريق",
    {
      blue: 1,
      yellow: 2,
      red: 1,
      xp: 5,
      trophyMilestones: [1, 5, 10, 25, 50, 75, 100],
      xpMultiplier: 1,
      blueMultiplier: 0.3 * 0.5,
      yellowMultiplier: 0.6 * 0.5,
      redMultiplier: 0.3 * 0.5,
    },
    TaskCategory.tasktype,
    undefined,
    "إماطة الأذى عن الطريق"
  ),

  ...generateChallenges(
    "التعاون",
    {
      blue: 1,
      yellow: 2,
      red: 1,
      xp: 5,
      trophyMilestones: [1, 5, 10, 25, 50, 75, 100],
      xpMultiplier: 1,
      blueMultiplier: 0.3 * 0.5,
      yellowMultiplier: 0.6 * 0.5,
      redMultiplier: 0.3 * 0.5,
    },
    TaskCategory.tasktype,
    undefined,
    "التعاون"
  ),

  ...generateChallenges(
    "الكلمة الطيبة والإحسان في القول",
    {
      blue: 1,
      yellow: 2,
      red: 1,
      xp: 5,
      trophyMilestones: [1, 5, 10, 25, 50, 75, 100],
      xpMultiplier: 1,
      blueMultiplier: 0.3 * 0.5,
      yellowMultiplier: 0.6 * 0.5,
      redMultiplier: 0.3 * 0.5,
    },
    TaskCategory.tasktype,
    undefined,
    "الكلمة الطيبة والإحسان في القول"
  ),

  ...generateChallenges(
    "المشاركة والإيثار",
    {
      blue: 1,
      yellow: 2,
      red: 1,
      xp: 5,
      trophyMilestones: [1, 5, 10, 25, 50, 75, 100],
      xpMultiplier: 1,
      blueMultiplier: 0.3 * 0.5,
      yellowMultiplier: 0.6 * 0.5,
      redMultiplier: 0.3 * 0.5,
    },
    TaskCategory.tasktype,
    undefined,
    "المشاركة والإيثار"
  ),

  ...generateChallenges(
    "قضاء الحوائج ومساعدة الآخرين",
    {
      blue: 1,
      yellow: 2,
      red: 1,
      xp: 5,
      trophyMilestones: [1, 5, 10, 25, 50, 75, 100],
      xpMultiplier: 1,
      blueMultiplier: 0.3 * 0.5,
      yellowMultiplier: 0.6 * 0.5,
      redMultiplier: 0.3 * 0.5,
    },
    TaskCategory.tasktype,
    undefined,
    "قضاء الحوائج ومساعدة الآخرين"
  ),

  ...generateChallenges(
    "عدم الإسراف",
    {
      blue: 1,
      yellow: 1,
      red: 2,
      xp: 5,
      trophyMilestones: [1, 5, 10, 25, 50, 75, 100],
      xpMultiplier: 1,
      blueMultiplier: 0.3 * 0.5,
      yellowMultiplier: 0.3 * 0.5,
      redMultiplier: 0.6 * 0.5,
    },
    TaskCategory.tasktype,
    undefined,
    "عدم الإسراف"
  ),

  ...generateChallenges(
    "الاحسان للمخلوقات (الطيور والحيوانات)",
    {
      blue: 1,
      yellow: 1,
      red: 2,
      xp: 5,
      trophyMilestones: [1, 5, 10, 25, 50, 75, 100],
      xpMultiplier: 1,
      blueMultiplier: 0.3 * 0.5,
      yellowMultiplier: 0.3 * 0.5,
      redMultiplier: 0.6 * 0.5,
    },
    TaskCategory.tasktype,
    undefined,
    "الاحسان للمخلوقات (الطيور والحيوانات)"
  ),

  ...generateChallenges(
    "الغرس",
    {
      blue: 1,
      yellow: 1,
      red: 2,
      xp: 5,
      trophyMilestones: [1, 5, 10, 25, 50, 75, 100],
      xpMultiplier: 1,
      blueMultiplier: 0.3 * 0.5,
      yellowMultiplier: 0.3 * 0.5,
      redMultiplier: 0.6 * 0.5,
    },
    TaskCategory.tasktype,
    undefined,
    "الغرس"
  ),

  ...generateChallenges(
    "الإحسان للأرض والنبات",
    {
      blue: 1,
      yellow: 1,
      red: 2,
      xp: 5,
      trophyMilestones: [1, 5, 10, 25, 50, 75, 100],
      xpMultiplier: 1,
      blueMultiplier: 0.3 * 0.5,
      yellowMultiplier: 0.3 * 0.5,
      redMultiplier: 0.6 * 0.5,
    },
    TaskCategory.tasktype,
    undefined,
    "الإحسان للأرض والنبات"
  ),
];

// Export the data and migration functions
export default {
  data: challengeData, // Explicitly export the data
  up: async (queryInterface: QueryInterface, Sequelize: Sequelize) => {
    await queryInterface.bulkInsert("Challenges", challengeData);
  },

  down: async (queryInterface: QueryInterface, Sequelize: Sequelize) => {
    await queryInterface.bulkDelete("Challenges", {});
  },
};
