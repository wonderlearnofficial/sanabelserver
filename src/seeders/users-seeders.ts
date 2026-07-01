// import { QueryInterface } from "sequelize";

// export default {
//   up: async (queryInterface, Sequelize) => {
//     await queryInterface.bulkInsert("Users", [
//       {
//         firstName: "الصلاة في الوقت",
//         LastName: "أداء جميع الصلوات في أوقاتها.",
//         Email: TaskCategory.Daily,
//         createdAt: new Date(),
//         updatedAt: new Date(),
//         type: "فجر",
//       },
//       {
//         title: "الصلاة في الوقت",
//         description: "أداء جميع الصلوات في أوقاتها.",
//         category: TaskCategory.Daily,
//         createdAt: new Date(),
//         updatedAt: new Date(),
//         type: "الظهر",
//       },
//       {
//         title: "الصلاة في الوقت",
//         description: "أداء جميع الصلوات في أوقاتها.",
//         category: TaskCategory.Daily,
//         createdAt: new Date(),
//         updatedAt: new Date(),
//         type: "العصر",
//       },
//       {
//         title: "الصلاة في الوقت",
//         description: "أداء جميع الصلوات في أوقاتها.",
//         category: TaskCategory.Daily,
//         createdAt: new Date(),
//         updatedAt: new Date(),
//         type: "المغرب",
//       },
//       {
//         title: "الصلاة في الوقت",
//         description: "أداء جميع الصلوات في أوقاتها.",
//         category: TaskCategory.Daily,
//         createdAt: new Date(),
//         updatedAt: new Date(),
//         type: "العشاء",
//       },
//       {
//         title: "ابتسم لشخص ما",
//         description: "نشر اللطف بابتسامة صادقة.",
//         category: TaskCategory.Daily,
//         createdAt: new Date(),
//         updatedAt: new Date(),
//       },
//       {
//         title: "المساعدة في الأعمال المنزلية",
//         description: "المساعدة في مهمة منزلية مثل غسل الصحون أو ترتيب المكان.",
//         category: TaskCategory.Daily,
//         createdAt: new Date(),
//         updatedAt: new Date(),
//       },
//       // Weekly Tasks
//       {
//         title: "زرع شجرة",
//         description: "المساهمة في البيئة بزرع شجرة أو رعاية نبات.",
//         category: TaskCategory.Weekly,
//         createdAt: new Date(),
//         updatedAt: new Date(),
//       },
//       {
//         title: "زيارة جيران",
//         description: "قضاء وقت مع الجيران أو مساعدتهم في مهمة أو حاجة.",
//         category: TaskCategory.Weekly,
//         createdAt: new Date(),
//         updatedAt: new Date(),
//       },
//       {
//         title: "التبرع للجمعيات الخيرية",
//         description: "التبرع لقضية خيرية (مال، ملابس، أو وقت).",
//         category: TaskCategory.Weekly,
//         createdAt: new Date(),
//         updatedAt: new Date(),
//       },
//       {
//         title: "التطوع في ملجأ",
//         description: "قضاء ساعة في مساعدة في مأوى مجتمعي.",
//         category: TaskCategory.Weekly,
//         createdAt: new Date(),
//         updatedAt: new Date(),
//       },
//     ]);
//   },

//   down: async (queryInterface: QueryInterface) => {
//     // This will delete all the data inserted by the seed
//     await queryInterface.bulkDelete("Tasks", {}, {});
//   },
// };
