import { QueryInterface } from "sequelize";

const taskCategories = [
  {
    id:1,
    title: "سنابل الإحسان في العلاقة مع الله",
    description: "خصص وقتًا لقراءة القرآن يوميًا وتأمل معانيه لتعزيز علاقتك بالله.",
    xp: 5,
    snabelRed: 2,
    snabelYellow: 2,
    snabelBlue: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id:2,

    title: "سنابل الإحسان في العلاقة مع النفس",
    description: "مارس التأمل أو الرياضة يوميًا لتعزيز صحتك النفسية والجسدية.",
    xp: 5,
    snabelRed: 1,
    snabelYellow: 1,
    snabelBlue: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id:3,

    title: "سنابل الإحسان في العلاقة مع الأسرة والمجتمع",
    description: "خصص وقتًا للجلوس مع عائلتك والتحدث معهم لبناء علاقة أقوى.",
    xp: 5,
    snabelRed: 1,
    snabelYellow: 2,
    snabelBlue: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id:4,

    title: "سنابل الإحسان في العلاقة مع الأرض والكون",
    description: "ساهم في الحفاظ على البيئة عبر تقليل استخدام البلاستيك وزراعة الأشجار.",
    xp: 5,
    snabelRed: 2,
    snabelYellow: 1,
    snabelBlue: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

export default {
  data: taskCategories,
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.bulkInsert("TaskCategories", taskCategories);
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.bulkDelete("TaskCategories", {});
  },
};
