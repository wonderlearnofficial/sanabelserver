const { runBenchmarkStep } = require("./run-benchmarks");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("==================================================");
  console.log("SANABEL CAPACITY ENGINEERING: BASELINE BENCHMARKS");
  console.log("Unoptimized Server State (DB pool max=30, default HTTP backlog, sync bcrypt)");
  console.log("==================================================");

  const results = [];

  // 1. Smoke test
  results.push(await runBenchmarkStep("Smoke Test (20 VUs)", "load-tests/smoke.js", {}));

  // 2. Individual endpoint groups (50 VUs each)
  results.push(await runBenchmarkStep("Group A (Public Infra: /health/live)", "load-tests/group-a-public.js", { TARGET_VUS: "200" }));
  results.push(await runBenchmarkStep("Group B (Student: /students/data, /mission/todo)", "load-tests/group-b-student.js", {}));
  results.push(await runBenchmarkStep("Group C (Teacher: /teachers/appear-class)", "load-tests/group-c-teacher.js", {}));
  results.push(await runBenchmarkStep("Group D (Parent: /parents/parent-data)", "load-tests/group-d-parent.js", {}));
  results.push(await runBenchmarkStep("Group E (School Admin: /admin/school-dashboard)", "load-tests/group-e-school-admin.js", {}));
  results.push(await runBenchmarkStep("Group F (Super Admin: /admin/analytics/overview)", "load-tests/group-f-super-admin.js", {}));
  results.push(await runBenchmarkStep("Write Idempotency (50 concurrent writes)", "load-tests/write-idempotency.js", {}));

  // 3. Concurrency Ladder (Mixed Traffic Profile)
  const ladderSteps = [10, 25, 50, 100, 250, 500];
  for (const vus of ladderSteps) {
    results.push(
      await runBenchmarkStep(
        `Mixed Traffic @ ${vus} VUs`,
        "load-tests/mixed-traffic.js",
        { TARGET_VUS: vus.toString(), DURATION: "20s" }
      )
    );
  }

  const outputPath = path.join(__dirname, "baseline-results.json");
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), "utf-8");
  console.log(`\n=== BASELINE BENCHMARKS COMPLETE ===`);
  console.log(`Results saved to ${outputPath}`);
}

main().catch(console.error);
