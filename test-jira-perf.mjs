import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  // Navigate to the app
  console.log('Navigating to http://localhost:5174...');
  await page.goto('http://localhost:5174', { waitUntil: 'networkidle', timeout: 30000 });
  console.log('✅ Page loaded');
  
  // Wait for page to be interactive
  await page.waitForTimeout(2000);
  
  // Take a screenshot to see current state
  await page.screenshot({ path: 'app-state-1.png' });
  console.log('📸 Screenshot 1 saved: app-state-1.png');
  
  // Get page title
  const title = await page.title();
  console.log(`📄 Page title: ${title}`);
  
  // List all visible links
  const links = await page.locator('a').allTextContents();
  console.log('📍 Available links:', links.slice(0, 15));
  
  // Get body text to understand the current page
  const bodyText = await page.locator('body').textContent();
  const firstLine = bodyText.split('\n').filter(l => l.trim()).slice(0, 3);
  console.log('📝 Page content sample:', firstLine);
  
  await browser.close();
})().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
