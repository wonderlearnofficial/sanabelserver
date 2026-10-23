const { runBenchmarkStep } = require("./run-benchmarks");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("==================================================");
  console.log("SANABEL CAPACITY ENGINEERING: POST-OPTIMIZATION 5K VERIFICATION");
  console.log("Optimized Server State (DB pool max=80, acquire=60s, backlog=4096, async bcrypt, streamlined logging)");
  console.log("==================================================");

  const results = [];

  // Concurrency ladder up to 5,000 VUs
  const targets = [
    { vus: 500, duration: "20s" },
    { vus: 1000, duration: "20s" },
    { vus: 2000, duration: "25s" },
    { vus: 3000, duration: "25s" },
    { vus: 4000, duration: "30s" },
    { vus: 5000, duration: "60s" }, // Final sustained 5,000 concurrency verification!
  ];

  for (const t of targets) {
    results.push(
      await runBenchmarkStep(
        `Optimized Mixed Traffic @ ${t.vus} VUs`,
        "load-tests/mixed-traffic.js",
        { TARGET_VUS: t.vus.toString(), DURATION: t.duration }
      )
    );
  }

  const outputPath = path.join(__dirname, "post-optimization-results.json");
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), "utf-8");
  console.log("\n=== POST-OPTIMIZATION VERIFICATION COMPLETE ===");
  console.log(`Results saved to ${outputPath}`);
}

main().catch(console.error);
