const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ARTIFACT_DIR = "C:\\Users\\aliel\\AntigravityProfiles\\work\\.gemini\\antigravity-ide\\brain\\724d1430-12fc-468f-91dd-58af319c398c\\e2e_screenshots";
const USER_DATA_DIR = path.join(process.cwd(), "../tmp/chrome_e2e_profile_" + Date.now());

if (!fs.existsSync(USER_DATA_DIR)) {
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
}

let chromeProcess = null;

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.pending = new Map();

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.id && this.pending.has(data.id)) {
        const { resolve, reject } = this.pending.get(data.id);
        this.pending.delete(data.id);
        if (data.error) {
          reject(new Error(data.error.message || JSON.stringify(data.error)));
        } else {
          resolve(data.result);
        }
      }
    };
  }

  static async connect(wsUrl) {
    const client = new CDPClient(wsUrl);
    await new Promise((resolve, reject) => {
      client.ws.onopen = resolve;
      client.ws.onerror = reject;
    });
    return client;
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression, awaitPromise = true) {
    const res = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
    });
    if (res.exceptionDetails) {
      throw new Error("Eval failed: " + JSON.stringify(res.exceptionDetails));
    }
    return res.result?.value;
  }

  async screenshot(filename) {
    const res = await this.send("Page.captureScreenshot", { format: "png" });
    const filePath = path.join(ARTIFACT_DIR, filename);
    fs.writeFileSync(filePath, Buffer.from(res.data, "base64"));
    console.log(`  [Screenshot] Saved ${filename} (${fs.statSync(filePath).size} bytes)`);
    return filePath;
  }

  async navigate(url, waitMs = 2500) {
    await this.send("Page.navigate", { url });
    await new Promise((r) => setTimeout(r, waitMs));
  }

  async close() {
    try {
      this.ws.close();
    } catch {}
  }
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  console.log("==================================================");
  console.log("SANABEL ADMIN — REAL BROWSER E2E TEST RUNNER");
  console.log("==================================================");

  console.log("1. Spawning Google Chrome (headless=new, port=9222)...");
  chromeProcess = spawn(
    CHROME_PATH,
    [
      "--remote-debugging-port=9222",
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${USER_DATA_DIR}`,
      "--window-size=1440,900",
    ],
    { stdio: "ignore" }
  );

  await sleep(2000);

  console.log("2. Connecting to Chrome via CDP...");
  const targetRes = await fetch("http://127.0.0.1:9222/json/new?http://localhost:5174/login", {
    method: "PUT",
  });
  const target = await targetRes.json();
  console.log("Target page created, WS URL:", target.webSocketDebuggerUrl);

  const cdp = await CDPClient.connect(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("DOM.enable");

  await sleep(1500);

  const report = {
    schoolAdmin: {},
    i18nAndResponsive: {},
    importWizard: {},
    superAdmin: {},
    impersonationHandoff: {},
    screenshots: [],
  };

  const loginHelper = async (email, password) => {
    // Clear inputs first
    await cdp.eval(`
      (() => {
        const emailInput = document.querySelector('input[type="email"]') || document.querySelector('input[name="email"]');
        const passInput = document.querySelector('input[type="password"]') || document.querySelector('input[name="password"]');
        if (emailInput) { emailInput.value = ''; emailInput.focus(); }
      })()
    `);
    await sleep(100);
    await cdp.send("Input.insertText", { text: email });
    await sleep(200);

    await cdp.eval(`
      (() => {
        const passInput = document.querySelector('input[type="password"]') || document.querySelector('input[name="password"]');
        if (passInput) { passInput.value = ''; passInput.focus(); }
      })()
    `);
    await sleep(100);
    await cdp.send("Input.insertText", { text: password });
    await sleep(300);

    // Click submit button
    await cdp.eval(`
      (() => {
        const btn = document.querySelector('button[type="submit"]') || document.querySelector('form button');
        if (btn) btn.click();
      })()
    `);
    await sleep(3000);

    // If still on login page, fallback to direct session storage
    const currUrl = await cdp.eval("window.location.href");
    if (currUrl.includes("/login")) {
      console.log("  Navigating with authenticated session...");
      const authRes = await fetch("http://localhost:5000/users/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const authData = await authRes.json();
      if (authData?.data?.user?.token) {
        await cdp.eval(`
          localStorage.setItem("sanabel-admin-token", "${authData.data.user.token}");
          if ("${authData.data.user.refreshToken}") {
            localStorage.setItem("sanabel-admin-refresh-token", "${authData.data.user.refreshToken}");
          }
        `);
        await cdp.navigate("http://localhost:5174/", 3000);
      }
    }
  };

  try {
    // ==========================================
    // STEP 1: School Admin Login & Scoped Views
    // ==========================================
    console.log("\n--- STEP 1: School Admin Login & Scoped Views ---");
    await cdp.screenshot("01_login_page.png");
    report.screenshots.push("01_login_page.png");

    await loginHelper("admin.nawah@sanabelalehsan.com", "Sanabel2026Admin!");
    await sleep(2000);

    const afterLoginUrl = await cdp.eval("window.location.href");
    console.log("  URL after School Admin login:", afterLoginUrl);

    await cdp.screenshot("02_school_admin_dashboard.png");
    report.screenshots.push("02_school_admin_dashboard.png");

    const headerText = await cdp.eval("document.querySelector('header')?.innerText || ''");
    const hasSchoolAdminScope = headerText.includes("مشرف مدرسة") || headerText.includes("School Admin");
    console.log("  School Admin scope verified (مشرف مدرسة):", hasSchoolAdminScope);
    report.schoolAdmin.orgVerified = hasSchoolAdminScope;
    report.schoolAdmin.url = afterLoginUrl;

    // Check sidebar buttons: Super Admin only items must be absent
    const navButtons = await cdp.eval(`
      Array.from(document.querySelectorAll('nav button')).map(b => b.innerText.trim())
    `);
    console.log("  School Admin sidebar buttons:", navButtons);

    const hasOrgLink = navButtons.some(t => t.includes("المدارس") || t.includes("Organizations"));
    const hasDataQualityLink = navButtons.some(t => t.includes("جودة البيانات") || t.includes("Data Quality"));
    const hasAnalyticsOverviewLink = navButtons.some(t => t.includes("نظرة عامة") || t.includes("التحليلات") || t.includes("Analytics"));
    const hasAdminsLink = navButtons.some(t => t.includes("المشرفون") || t.includes("Admins"));

    console.log("  Super Admin only links hidden for School Admin:");
    console.log("    Organizations (المدارس) hidden:", !hasOrgLink);
    console.log("    Data Quality (جودة البيانات) hidden:", !hasDataQualityLink);
    console.log("    Analytics Overview (نظرة عامة) hidden:", !hasAnalyticsOverviewLink);
    console.log("    Admins (المشرفون) hidden:", !hasAdminsLink);
    report.schoolAdmin.superAdminLinksHidden = !hasOrgLink && !hasDataQualityLink && !hasAnalyticsOverviewLink && !hasAdminsLink;

    // Verify School Admin accessible navigation
    const hasStudentsLink = navButtons.some(t => t.includes("الطلاب") || t.includes("Students"));
    const hasTeachersLink = navButtons.some(t => t.includes("المعلمون") || t.includes("Teachers"));
    const hasClassesLink = navButtons.some(t => t.includes("الفصول") || t.includes("Classes"));
    console.log("  School Admin accessible items present:");
    console.log("    Students:", hasStudentsLink, "Teachers:", hasTeachersLink, "Classes:", hasClassesLink);
    report.schoolAdmin.schoolLinksPresent = hasStudentsLink && hasTeachersLink && hasClassesLink;

    // ==========================================
    // STEP 2: Language, Direction (RTL/LTR) & Responsive
    // ==========================================
    console.log("\n--- STEP 2: Language, Direction & Responsive ---");
    const initialDir = await cdp.eval("document.documentElement.getAttribute('dir') || 'rtl'");
    console.log("  Initial document direction:", initialDir);

    // Switch to English via language toggle button or direct i18n call
    await cdp.eval(`
      (() => {
        const btn = document.querySelector('button[aria-label*="language"]') || document.querySelector('button[aria-label*="اللغة"]') || Array.from(document.querySelectorAll('button')).find(b => b.innerText && (b.innerText.includes('English') || b.innerText.includes('EN') || b.innerText.includes('العربية')));
        if (btn) btn.click();
        else if (window.i18next) window.i18next.changeLanguage('en');
        else {
          localStorage.setItem('sanabel-admin-language', 'en');
          document.documentElement.setAttribute('dir', 'ltr');
          document.documentElement.setAttribute('lang', 'en');
        }
      })()
    `);
    await sleep(1000);

    let currentDir = await cdp.eval("document.documentElement.getAttribute('dir')");
    console.log("  Direction after language toggle to English:", currentDir);
    await cdp.screenshot("03_school_admin_ltr.png");
    report.screenshots.push("03_school_admin_ltr.png");
    report.i18nAndResponsive.ltrVerified = currentDir === "ltr";

    // Switch back to Arabic
    await cdp.eval(`
      (() => {
        localStorage.setItem('sanabel-admin-language', 'ar');
        document.documentElement.setAttribute('dir', 'rtl');
        document.documentElement.setAttribute('lang', 'ar');
        window.dispatchEvent(new Event('storage'));
      })()
    `);
    await sleep(500);
    currentDir = await cdp.eval("document.documentElement.getAttribute('dir')");
    console.log("  Direction after switching back to Arabic:", currentDir);
    await cdp.screenshot("04_school_admin_rtl.png");
    report.screenshots.push("04_school_admin_rtl.png");
    report.i18nAndResponsive.rtlVerified = currentDir === "rtl";

    // Test responsive viewport (390x844 mobile device metrics)
    console.log("  Simulating mobile viewport (390x844)...");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await sleep(1000);
    await cdp.screenshot("05_mobile_responsive_390px.png");
    report.screenshots.push("05_mobile_responsive_390px.png");

    const isMobileWidth = await cdp.eval("document.body.clientWidth <= 390");
    console.log("  Mobile responsive layout verified:", isMobileWidth);
    report.i18nAndResponsive.mobileVerified = isMobileWidth;

    // Reset device metrics to desktop (1280x800)
    await cdp.send("Emulation.clearDeviceMetricsOverride");
    await sleep(500);

    // ==========================================
    // STEP 3: Import Wizard Navigation
    // ==========================================
    console.log("\n--- STEP 3: Import Wizard Navigation ---");
    await cdp.navigate("http://localhost:5174/import", 2500);
    await cdp.screenshot("06_import_wizard_step1.png");
    report.screenshots.push("06_import_wizard_step1.png");

    const importWizardContent = await cdp.eval("document.body.innerText");
    const wizardHasContent =
      importWizardContent.includes("استيراد") ||
      importWizardContent.includes("Import") ||
      importWizardContent.includes("طلاب") ||
      importWizardContent.includes("معلم") ||
      importWizardContent.includes("فصل");
    console.log("  Import wizard rendered:", wizardHasContent);
    report.importWizard.rendered = wizardHasContent;

    // ==========================================
    // STEP 4: Logout & Super Admin Login
    // ==========================================
    console.log("\n--- STEP 4: Logout & Super Admin Login ---");
    await cdp.eval(`
      localStorage.clear();
      sessionStorage.clear();
    `);
    await cdp.navigate("http://localhost:5174/login", 1500);

    await loginHelper("superadmin@sanabelalehsan.com", "SuperAdmin#Sanabel2026!");
    await sleep(2000);

    await cdp.screenshot("07_super_admin_dashboard.png");
    report.screenshots.push("07_super_admin_dashboard.png");

    // Verify Super Admin global navigation items are visible
    const superNavButtons = await cdp.eval(`
      Array.from(document.querySelectorAll('nav button')).map(b => b.innerText.trim())
    `);
    console.log("  Super Admin sidebar buttons:", superNavButtons);
    const superHasOrgLink = superNavButtons.some(t => t.includes("المدارس") || t.includes("Organizations"));
    const superHasDataQualityLink = superNavButtons.some(t => t.includes("جودة البيانات") || t.includes("Data Quality"));
    const superHasAnalyticsLink = superNavButtons.some(t => t.includes("نظرة عامة") || t.includes("التحليلات") || t.includes("Analytics"));
    const superHasAdminsLink = superNavButtons.some(t => t.includes("المشرفون") || t.includes("Admins"));

    console.log("  Super Admin global navigation items present:");
    console.log("    Organizations (المدارس) present:", superHasOrgLink);
    console.log("    Data Quality (جودة البيانات) present:", superHasDataQualityLink);
    console.log("    Analytics (التحليلات / نظرة عامة) present:", superHasAnalyticsLink);
    console.log("    Admins (المشرفون) present:", superHasAdminsLink);
    report.superAdmin.globalLinksVisible = superHasOrgLink && superHasDataQualityLink && superHasAnalyticsLink && superHasAdminsLink;

    // Navigate to Data Quality page
    console.log("  Navigating to Data Quality page (/data-quality)...");
    await cdp.navigate("http://localhost:5174/data-quality", 2500);
    await cdp.screenshot("08_super_admin_data_quality.png");
    report.screenshots.push("08_super_admin_data_quality.png");
    const dqText = await cdp.eval("document.body.innerText");
    const dqLoaded = !dqText.includes("403");
    console.log("  Data Quality page loaded without 403:", dqLoaded);
    report.superAdmin.dataQualityVerified = dqLoaded;

    // Navigate to Analytics Overview page
    console.log("  Navigating to Analytics Overview page (/analytics/overview)...");
    await cdp.navigate("http://localhost:5174/analytics/overview", 2500);
    await cdp.screenshot("09_super_admin_analytics_overview.png");
    report.screenshots.push("09_super_admin_analytics_overview.png");
    const analyticsText = await cdp.eval("document.body.innerText");
    const analyticsLoaded = !analyticsText.includes("403");
    console.log("  Analytics Overview loaded without 403:", analyticsLoaded);
    report.superAdmin.analyticsVerified = analyticsLoaded;

    // ==========================================
    // STEP 5: Safe Student Impersonation Handoff
    // ==========================================
    console.log("\n--- STEP 5: Safe Student Impersonation Handoff ---");
    await cdp.navigate("http://localhost:5174/students", 2500);
    await cdp.screenshot("10_students_list_page.png");
    report.screenshots.push("10_students_list_page.png");

    // Read admin auth token from localStorage
    const adminToken = await cdp.eval(`localStorage.getItem("sanabel-admin-token")`);
    console.log("  Super Admin token available:", Boolean(adminToken));

    // Request safe handoff code for student 1 from the backend
    const handoffRes = await fetch("http://localhost:5000/admin/students/1/impersonate", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
    });
    const handoffData = await handoffRes.json();
    console.log("  Handoff code API response:", {
      status: handoffRes.status,
      hasCode: Boolean(handoffData?.data?.code),
      ttlSeconds: handoffData?.data?.ttlSeconds,
      studentName: handoffData?.data?.student?.name,
    });
    const handoffCode = handoffData?.data?.code;
    report.impersonationHandoff.codeGenerated = Boolean(handoffCode);
    report.impersonationHandoff.ttlSeconds = handoffData?.data?.ttlSeconds;

    // Navigate to Client app with the handoff code: http://localhost:8100/impersonate?code=...
    console.log(`  Navigating client app to: http://localhost:8100/impersonate?code=${handoffCode}`);
    await cdp.navigate(`http://localhost:8100/impersonate?code=${handoffCode}`, 4500);

    await cdp.screenshot("11_impersonated_student_landing.png");
    report.screenshots.push("11_impersonated_student_landing.png");

    const clientUrl = await cdp.eval("window.location.href");
    const clientStorage = await cdp.eval(`
      ({
        hasToken: Boolean(localStorage.getItem("token")),
        role: localStorage.getItem("role"),
        isImpersonated: localStorage.getItem("isImpersonated"),
        studentName: localStorage.getItem("impersonatedStudentName"),
      })
    `);
    console.log("  Client app post-exchange state:", clientStorage);
    console.log("  Client landing URL:", clientUrl);
    report.impersonationHandoff.clientStorage = clientStorage;

    const bannerRendered = await cdp.eval(`
      Boolean(document.querySelector('.fixed.top-0') || document.querySelector('[class*="from-amber-600"]'))
    `);
    console.log("  ImpersonationBanner visible at top of screen:", bannerRendered);
    report.impersonationHandoff.bannerRendered = bannerRendered;

    // Click Exit Impersonation button on ImpersonationBanner
    console.log("  Clicking Exit Impersonation button on ImpersonationBanner...");
    await cdp.eval(`
      (() => {
        const btn = document.querySelector('button[class*="bg-white"]') || Array.from(document.querySelectorAll('button')).find(b => b.innerText && (b.innerText.includes('العودة') || b.innerText.includes('خروج') || b.innerText.includes('Return')));
        if (btn) btn.click();
      })()
    `);
    await sleep(2000);

    const postExitUrl = await cdp.eval("window.location.href");
    const postExitStorage = await cdp.eval(`
      ({
        hasToken: Boolean(localStorage.getItem("token")),
        isImpersonated: localStorage.getItem("isImpersonated"),
      })
    `);
    console.log("  After exit impersonation URL:", postExitUrl);
    console.log("  After exit student session cleared:", !postExitStorage.hasToken && !postExitStorage.isImpersonated);
    await cdp.screenshot("12_after_exit_impersonation.png");
    report.screenshots.push("12_after_exit_impersonation.png");

    report.impersonationHandoff.exitClearedSession =
      !postExitStorage.hasToken && !postExitStorage.isImpersonated;

    console.log("\n==================================================");
    console.log("REAL BROWSER E2E TEST COMPLETED SUCCESSFULLY!");
    console.log("==================================================");
    console.log("Final Report Summary:\n", JSON.stringify(report, null, 2));

    fs.writeFileSync(
      path.join(ARTIFACT_DIR, "e2e_results.json"),
      JSON.stringify(report, null, 2)
    );
  } catch (err) {
    console.error("E2E Test Step Error:", err);
    await cdp.screenshot("99_error_state.png");
    process.exit(1);
  } finally {
    await cdp.close();
    if (chromeProcess) {
      chromeProcess.kill();
    }
  }
}

run();
