/* One-off runtime verification for the theme toggle. Drives the dev server
 * with system Edge via Playwright (channel msedge — no browser download).
 * Run: NODE_PATH=<npx playwright cache> node scripts/verify-theme-toggle.cjs <url> <shotdir>
 */
const { chromium } = require("playwright");
const path = require("node:path");

const URL = process.argv[2] || "http://localhost:5176/";
const SHOTS = process.argv[3] || process.env.TEMP;
const shot = (n) => path.join(SHOTS, n);

const results = [];
function step(ok, label, detail) {
  results.push({ ok, label, detail });
  console.log(`${ok ? "PASS" : "FAIL"} | ${label}${detail ? " | " + detail : ""}`);
}

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });

  // ---- main flow: light -> dark -> reload -> light ----
  const ctx = await browser.newContext({
    colorScheme: "light",
    viewport: { width: 1440, height: 900 },
  });
  // Record what data-theme was at DOMContentLoaded — proves the pre-paint
  // script ran before first render (no light flash on dark reload).
  await ctx.addInitScript(() => {
    // documentElement does not exist yet at init-script time — guard it.
    window.__themeAtInit = document.documentElement?.dataset.theme || "(unset)";
    document.addEventListener("DOMContentLoaded", () => {
      window.__themeAtDCL = document.documentElement.dataset.theme || "(unset)";
    });
  });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForSelector(".theme-toggle", { timeout: 15000 });

  const themeAttr = () => page.evaluate(() => document.documentElement.dataset.theme);
  const bodyBg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const sidebarBg = () => page.evaluate(() => getComputedStyle(document.querySelector("aside")).backgroundColor);
  const discD = () => page.evaluate(() => getComputedStyle(document.querySelector(".tt-disc")).d);
  const raysOpacity = () => page.evaluate(() => getComputedStyle(document.querySelector(".tt-rays")).opacity);

  // (1) light mode initial render
  const t0 = await themeAttr();
  const bg0 = await bodyBg();
  step(t0 === "light" && bg0 === "rgb(246, 246, 247)", "initial light mode", `data-theme=${t0} bodyBg=${bg0}`);
  const appearanceRow = await page.getByText("Appearance", { exact: true }).isVisible();
  const sunD = await discD();
  const rays0 = await raysOpacity();
  step(appearanceRow && rays0 === "1", "sun icon in sidebar 'Appearance' row", `raysOpacity=${rays0} d=${(sunD || "").slice(0, 40)}…`);
  await page.screenshot({ path: shot("theme-1-light.png") });

  // (2) click -> dark; grab a mid-ripple frame on the way
  await page.click(".theme-toggle");
  await page.waitForTimeout(220);
  await page.screenshot({ path: shot("theme-2-ripple-mid.png") });
  await page.waitForTimeout(900);
  const t1 = await themeAttr();
  const bg1 = await bodyBg();
  const sb1 = await sidebarBg();
  step(t1 === "dark" && bg1 === "rgb(16, 17, 20)", "dark palette applied", `data-theme=${t1} bodyBg=${bg1}`);
  step(sb1 === "rgb(23, 24, 28)", "cards/sidebar use dark surface", `asideBg=${sb1}`);
  const moonD = await discD();
  const rays1 = await raysOpacity();
  step(moonD !== sunD && rays1 === "0", "icon morphed to moon (d changed, rays hidden)", `raysOpacity=${rays1} d=${(moonD || "").slice(0, 40)}…`);

  // (3) localStorage persisted
  const ls1 = await page.evaluate(() => localStorage.getItem("kpi.theme"));
  step(ls1 === "dark", "localStorage kpi.theme=dark", `value=${ls1}`);
  await page.screenshot({ path: shot("theme-3-dark.png") });

  // (4) reload: dark from the very first paint
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".theme-toggle");
  const atDCL = await page.evaluate(() => window.__themeAtDCL);
  const t2 = await themeAttr();
  step(t2 === "dark" && atDCL === "dark", "reload keeps dark, set before DOMContentLoaded (no flash)", `themeAtDCL=${atDCL}`);
  const moonD2 = await discD();
  step(moonD2 === moonD, "moon icon shown after dark reload", "");

  // (5) toggle back to light
  await page.click(".theme-toggle");
  await page.waitForTimeout(1100);
  const t3 = await themeAttr();
  const ls2 = await page.evaluate(() => localStorage.getItem("kpi.theme"));
  step(t3 === "light" && ls2 === "light", "second click returns to light + persists", `data-theme=${t3} ls=${ls2}`);

  // PROBE: rapid double-click must land back where it started (race fix)
  await page.click(".theme-toggle");
  await page.click(".theme-toggle", { delay: 10 });
  await page.waitForTimeout(1500);
  const t4 = await themeAttr();
  const ls3 = await page.evaluate(() => localStorage.getItem("kpi.theme"));
  step(t4 === "light" && ls3 === "light", "PROBE rapid double-click nets to original theme", `data-theme=${t4} ls=${ls3}`);

  // PROBE: keyboard activation
  await page.focus(".theme-toggle");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1100);
  const t5 = await themeAttr();
  step(t5 === "dark", "PROBE Enter key toggles", `data-theme=${t5}`);
  const aria = await page.getAttribute(".theme-toggle", "aria-label");
  step(aria === "Switch to light theme", "PROBE aria-label flips with state", `aria-label=${aria}`);
  await ctx.close();

  // PROBE: prefers-reduced-motion — theme still flips, no fade class lingers
  const rmCtx = await browser.newContext({ colorScheme: "light", reducedMotion: "reduce" });
  const rmPage = await rmCtx.newPage();
  await rmPage.goto(URL, { waitUntil: "networkidle" });
  await rmPage.waitForSelector(".theme-toggle");
  await rmPage.evaluate(() => localStorage.setItem("kpi.theme", "light"));
  await rmPage.click(".theme-toggle");
  await rmPage.waitForTimeout(300);
  const rmTheme = await rmPage.evaluate(() => document.documentElement.dataset.theme);
  const rmFade = await rmPage.evaluate(() => document.documentElement.classList.contains("theme-fade"));
  step(rmTheme === "dark" && !rmFade, "PROBE reduced-motion still applies theme, no fade class", `theme=${rmTheme} fadeClass=${rmFade}`);
  await rmCtx.close();

  // PROBE: OS dark preference picked up with no stored choice
  const osCtx = await browser.newContext({ colorScheme: "dark" });
  const osPage = await osCtx.newPage();
  await osPage.goto(URL, { waitUntil: "networkidle" });
  const osTheme = await osPage.evaluate(() => document.documentElement.dataset.theme);
  step(osTheme === "dark", "PROBE prefers-color-scheme:dark honored on first visit", `theme=${osTheme}`);
  await osCtx.close();

  await browser.close();
  const fails = results.filter((r) => !r.ok);
  console.log(`\n${results.length - fails.length}/${results.length} checks passed`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error("SCRIPT ERROR:", e); process.exit(2); });
