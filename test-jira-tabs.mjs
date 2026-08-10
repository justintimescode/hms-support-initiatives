import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  console.log('🚀 Starting Jira tab performance test...\n');
  
  // Navigate to the app
  await page.goto('http://localhost:5174', { waitUntil: 'networkidle', timeout: 30000 });
  console.log('✅ App loaded');
  
  // Wait for page to be interactive
  await page.waitForTimeout(2000);
  
  const tabs = [
    { name: "All HMS Jira's", selector: 'a:has-text("All HMS Jira\'s")' },
    { name: 'Statistics', selector: 'a:has-text("Statistics")' },
    { name: 'Cases w/ Jira Blockers', selector: 'a:has-text("Cases w/ Jira Blockers")' },
  ];
  
  for (const tab of tabs) {
    const startTime = Date.now();
    console.log(`\n📍 Clicking on "${tab.name}" tab...`);
    
    try {
      // Click the tab
      await page.click(tab.selector);
      
      // Wait for the page to load (networkidle)
      await page.waitForLoadState('networkidle');
      
      const loadTime = Date.now() - startTime;
      console.log(`✅ Tab loaded in ${loadTime}ms`);
      
      // Take a screenshot
      const filename = `tab-${tab.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.png`;
      await page.screenshot({ path: filename });
      console.log(`📸 Screenshot saved: ${filename}`);
      
      // Check if content is visible
      const content = await page.locator('main, [role="main"]').first();
      if (await content.isVisible()) {
        console.log('✅ Tab content is visible');
      } else {
        console.log('⚠️  Main content not immediately visible (may be loading)');
      }
      
      // Measure response time for another click (should be instant since it's already loaded)
      if (tabs.indexOf(tab) < tabs.length - 1) {
        await page.waitForTimeout(500); // Wait a bit before switching again
        const nextTab = tabs[tabs.indexOf(tab) + 1];
        const switchTime = Date.now();
        await page.click(nextTab.selector);
        await page.waitForLoadState('networkidle');
        const switchLoadTime = Date.now() - switchTime;
        console.log(`⏱️  Quick tab switch: ${switchLoadTime}ms`);
      }
      
    } catch (err) {
      console.log(`❌ Error clicking tab: ${err.message}`);
    }
  }
  
  console.log('\n🎉 Test completed!');
  await browser.close();
})().catch(err => {
  console.error('❌ Fatal error:', err.message);
  process.exit(1);
});
