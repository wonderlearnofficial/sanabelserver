import { Sequelize } from "sequelize";
import { QueryInterface } from "sequelize";

const Task = require("../models/task.model").default;  // If using CommonJS

export default {
    up: async (queryInterface: QueryInterface, Sequelize: Sequelize) => {
        console.log("Task model:", Task);  // Log Task model to verify it's imported

        const task = await Task.findOne({
            where: { title: "الصلاة في الوقت" },
        });


        if (!task) {
            console.log("Task 'الصلاة في الوقت' not found.");
            return;
        }

        try {
            await queryInterface.bulkInsert("TaskTypes", [
                {
                    TaskId: task.id,
                    type: "فجر",  // Fajr
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    TaskId: task.id,
                    type: "طهر",  // Dhuhr
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    TaskId: task.id,
                    type: "عصر",  // Asr
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    TaskId: task.id,
                    type: "مغرب",  // Maghrib
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    TaskId: task.id,
                    type: "عشاء",  // Isha
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ]);
        } catch (error) {
            console.error("Error inserting TaskTypes:", error);
        }
    },

    down: async (queryInterface: QueryInterface, Sequelize: Sequelize) => {
        const task = await Task.findOne({
            where: { title: "الصلاة في الوقت" },
        });

        if (task) {
            await queryInterface.bulkDelete("TaskTypes", { TaskId: task.id }, {});
        }
    },
};
