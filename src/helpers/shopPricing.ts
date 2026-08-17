// Shop pricing and balance math for the water/seeder store.
//
// The store charges the SAME total from each of the three sanabel colors
// (red, blue, yellow) — a purchase of total cost N needs N of every color.
// These values must match the client's Shop.tsx pricing; the first tree
// level is discounted to keep the early game accessible.

export interface SanabelBalances {
  snabelRed: number;
  snabelBlue: number;
  snabelYellow: number;
}

export const getShopUnitCosts = (treeProgress: number) => ({
  waterCost: treeProgress === 1 ? 10 : 20,
  seederCost: treeProgress === 1 ? 15 : 30,
});

export const computeSanabelCostPerColor = (
  water: number,
  seeders: number,
  treeProgress: number,
): number => {
  const { waterCost, seederCost } = getShopUnitCosts(treeProgress);
  return waterCost * water + seederCost * seeders;
};

export const computeMissingSanabel = (
  requiredPerColor: number,
  balances: Partial<SanabelBalances>,
): SanabelBalances => ({
  snabelRed: Math.max(0, requiredPerColor - (balances.snabelRed || 0)),
  snabelBlue: Math.max(0, requiredPerColor - (balances.snabelBlue || 0)),
  snabelYellow: Math.max(0, requiredPerColor - (balances.snabelYellow || 0)),
});

export const hasSufficientSanabel = (
  requiredPerColor: number,
  balances: Partial<SanabelBalances>,
): boolean => {
  const missing = computeMissingSanabel(requiredPerColor, balances);
  return (
    missing.snabelRed === 0 &&
    missing.snabelBlue === 0 &&
    missing.snabelYellow === 0
  );
};
