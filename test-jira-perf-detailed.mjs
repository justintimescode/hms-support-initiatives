import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  // Collect console messages and errors
  const logs = [];
  const errors = [];
  
  page.on('console', msg => {
    logs.push(`[${msg.type().toUpperCase()}] ${msg.text()}`);
  });
  
  page.on('pageerror', err => {
    errors.push(err.message);
  });
  
  console.log('🚀 Detailed performance test with repeated tab switching...\n');
  
  // Navigate to the app
  await page.goto('http://localhost:5174', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);
  
  const tabs = [
    { name: "All HMS Jira's", selector: 'a:has-text("All HMS Jira\'s")' },
    { name: 'Statistics', selector: 'a:has-text("Statistics")' },
    { name: 'Cases w/ Jira Blockers', selector: 'a:has-text("Cases w/ Jira Blockers")' },
  ];
  
  console.log('📊 Rapid tab switching test (should be responsive, not frozen):');
  const times = [];
  
  // Simulate rapid clicks (what happens when user clicks between tabs)
  for (let i = 0; i < 3; i++) {
    for (const tab of tabs) {
      const startTime = Date.now();
      await page.click(tab.selector);
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      const time = Date.now() - startTime;
      times.push({ tab: tab.name, time, iteration: i + 1 });
      process.stdout.write(`✅ ${tab.name.padEnd(25)} - ${time.toString().padStart(4)}ms (iteration ${i + 1})\n`);
    }
  }
  
  // Analyze results
  console.log('\n📈 Performance Summary:');
  const avgTimes = {};
  for (const record of times) {
    if (!avgTimes[record.tab]) avgTimes[record.tab] = [];
    avgTimes[record.tab].push(record.time);
  }
  
  for (const [tab, times] of Object.entries(avgTimes)) {
    const avg = Math.round(times.reduce((a, b) => a + b) / times.length);
    const max = Math.max(...times);
    const min = Math.min(...times);
    console.log(`  ${tab.padEnd(25)} - avg: ${avg.toString().padStart(4)}ms, min: ${min}ms, max: ${max}ms`);
  }
  
  // Check for errors
  if (errors.length > 0) {
    console.log('\n⚠️  Errors detected:');
    errors.forEach(e => console.log(`  - ${e}`));
  } else {
    console.log('\n✅ No JavaScript errors detected');
  }
  
  // Check for freeze-like behavior (if any request takes > 1000ms except the first)
  const freezes = times.filter((t, i) => i > 0 && t.time > 1000);
  if (freezes.length > 0) {
    console.log(`\n⚠️  Potential freezes detected (${freezes.length}):`);
    freezes.forEach(f => console.log(`  - ${f.tab}: ${f.time}ms`));
  } else {
    console.log('\n✅ No freezes detected - all tab switches responsive!');
  }
  
  // Take final screenshot
  await page.screenshot({ path: 'final-state.png' });
  console.log('\n📸 Final state screenshot: final-state.png');
  
  await browser.close();
})().catch(err => {
  console.error('❌ Fatal error:', err.message);
  process.exit(1);
});
