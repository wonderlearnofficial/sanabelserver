import taskCategorySeed from "../seeders/task-category";

export const DEFAULT_TASK_CATEGORY_TITLES = taskCategorySeed.data.map(
  (category) => category.title,
);

export const buildCategoryCounts = (
  databaseTitles: readonly string[],
  observedCounts: Record<string, unknown>,
): Record<string, number> => {
  const titles = Array.from(
    new Set([...DEFAULT_TASK_CATEGORY_TITLES, ...databaseTitles]),
  );

  return titles.reduce((counts, title) => {
    const parsed = Number(observedCounts[title]);
    counts[title] = Number.isFinite(parsed) ? parsed : 0;
    return counts;
  }, {} as Record<string, number>);
};
