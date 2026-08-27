const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  // Navigate to the app
  await page.goto('http://localhost:5174', { waitUntil: 'networkidle' });
  console.log('✅ Page loaded');
  
  // Check if we're on the connections page (no data loaded yet)
  const heading = await page.locator('text=ServiceNow').first();
  if (await heading.isVisible()) {
    console.log('✅ App is running');
  }
  
  // Wait a moment for the page to stabilize
  await page.waitForTimeout(1000);
  
  // Try to find Jira-related elements
  const jiraLinks = await page.locator('a:has-text("Jira"), a:has-text("Connections")').all();
  console.log(`Found ${jiraLinks.length} navigation links`);
  
  // Look for the tab navigation
  const tabs = await page.locator('[role="tab"], button:has-text("Jira"), a:has-text("Statistics")').all();
  console.log(`Found ${tabs.length} tab-like elements`);
  
  // Get all links and buttons that might be navigation
  const allLinks = await page.locator('a, button').all();
  console.log(`Found ${allLinks.length} total clickable elements`);
  
  // Log all text content of navigation elements
  const nav = await page.locator('nav, [role="navigation"]').all();
  console.log(`Found ${nav.length} navigation containers`);
  
  // List all links with text
  const linkTexts = await page.locator('a').allTextContents();
  console.log('Available links:', linkTexts.slice(0, 20));
  
  await browser.close();
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
