import { Sequelize } from "sequelize";
import { QueryInterface } from "sequelize";

const { Tree } = require("../models/tree.model");
const treeData = [
  { id: 1, treeProgress: 1, water: 1, seeders: 1, stage: 1 },
  { id: 2, treeProgress: 2, water: 1, seeders: 1, stage: 1 },
  { id: 3, treeProgress: 3, water: 1, seeders: 1, stage: 1 },
  { id: 4, treeProgress: 4, water: 1, seeders: 1, stage: 1 },
  { id: 5, treeProgress: 5, water: 5, seeders: 5, stage: 1 },
  { id: 6, treeProgress: 6, water: 2, seeders: 2, stage: 2 },
  { id: 7, treeProgress: 7, water: 2, seeders: 2, stage: 2 },
  { id: 8, treeProgress: 8, water: 2, seeders: 2, stage: 2 },
  { id: 9, treeProgress: 9, water: 2, seeders: 2, stage: 2 },
  { id: 10, treeProgress: 10, water: 2, seeders: 2, stage: 2 },
  { id: 11, treeProgress: 11, water: 3, seeders: 2, stage: 2 },
  { id: 12, treeProgress: 12, water: 3, seeders: 2, stage: 2 },
  { id: 13, treeProgress: 13, water: 3, seeders: 2, stage: 2 },
  { id: 14, treeProgress: 14, water: 3, seeders: 2, stage: 2 },
  { id: 15, treeProgress: 15, water: 10, seeders: 10, stage: 2 },
  { id: 16, treeProgress: 16, water: 4, seeders: 3, stage: 3 },
  { id: 17, treeProgress: 17, water: 4, seeders: 3, stage: 3 },
  { id: 18, treeProgress: 18, water: 4, seeders: 3, stage: 3 },
  { id: 19, treeProgress: 19, water: 4, seeders: 3, stage: 3 },
  { id: 20, treeProgress: 20, water: 4, seeders: 3, stage: 3 },
  { id: 21, treeProgress: 21, water: 4, seeders: 3, stage: 3 },
  { id: 22, treeProgress: 22, water: 4, seeders: 3, stage: 3 },
  { id: 23, treeProgress: 23, water: 4, seeders: 3, stage: 3 },
  { id: 24, treeProgress: 24, water: 5, seeders: 3, stage: 3 },
  { id: 25, treeProgress: 25, water: 5, seeders: 3, stage: 3 },
  { id: 26, treeProgress: 26, water: 5, seeders: 3, stage: 3 },
  { id: 27, treeProgress: 27, water: 5, seeders: 3, stage: 3 },
  { id: 28, treeProgress: 28, water: 5, seeders: 3, stage: 3 },
  { id: 29, treeProgress: 29, water: 5, seeders: 3, stage: 3 },
  { id: 30, treeProgress: 30, water: 15, seeders: 15, stage: 3 },
  { id: 31, treeProgress: 31, water: 6, seeders: 4, stage: 4 },
  { id: 32, treeProgress: 32, water: 6, seeders: 4, stage: 4 },
  { id: 33, treeProgress: 33, water: 6, seeders: 4, stage: 4 },
  { id: 34, treeProgress: 34, water: 6, seeders: 4, stage: 4 },
  { id: 35, treeProgress: 35, water: 6, seeders: 4, stage: 4 },
  { id: 36, treeProgress: 36, water: 6, seeders: 4, stage: 4 },
  { id: 37, treeProgress: 37, water: 7, seeders: 4, stage: 4 },
  { id: 38, treeProgress: 38, water: 7, seeders: 4, stage: 4 },
  { id: 39, treeProgress: 39, water: 7, seeders: 4, stage: 4 },
  { id: 40, treeProgress: 40, water: 7, seeders: 4, stage: 4 },
  { id: 41, treeProgress: 41, water: 7, seeders: 4, stage: 4 },
  { id: 42, treeProgress: 42, water: 7, seeders: 4, stage: 4 },
  { id: 43, treeProgress: 43, water: 7, seeders: 4, stage: 4 },
  { id: 44, treeProgress: 44, water: 7, seeders: 4, stage: 4 },
  { id: 45, treeProgress: 45, water: 7, seeders: 4, stage: 4 },
  { id: 46, treeProgress: 46, water: 7, seeders: 4, stage: 4 },
  { id: 47, treeProgress: 47, water: 7, seeders: 4, stage: 4 },
  { id: 48, treeProgress: 48, water: 7, seeders: 4, stage: 4 },
  { id: 49, treeProgress: 49, water: 7, seeders: 4, stage: 4 },
  { id: 50, treeProgress: 50, water: 20, seeders: 20, stage: 4 },
  { id: 51, treeProgress: 51, water: 0, seeders: 0, stage: 4 },
];
export default {
  data: treeData, // ✅ Explicitly export the data
  up: async (queryInterface: QueryInterface, Sequelize: Sequelize) => {
    await queryInterface.bulkInsert("Trees", treeData);
  },

  down: async (queryInterface: QueryInterface, Sequelize: Sequelize) => {
    await queryInterface.bulkDelete("Trees", {}, {});
  },
};
