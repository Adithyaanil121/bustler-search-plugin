const puppeteer = require('puppeteer');
const { PuppeteerScreenRecorder } = require('puppeteer-screen-recorder');

(async () => {
  const browser = await puppeteer.launch({
    headless: "new",
    defaultViewport: { width: 1280, height: 720 }
  });
  const page = await browser.newPage();
  
  const recorder = new PuppeteerScreenRecorder(page, {
    followNewTab: true,
    fps: 30,
    videoFrame: { width: 1280, height: 720 },
    videoCrf: 18,
    videoCodec: 'libx264',
    videoPreset: 'ultrafast',
    videoBitrate: 1000,
    autopad: { color: 'black' },
    aspectRatio: '16:9',
  });

  console.log('Navigating to page...');
  await page.goto('http://localhost:3001/index.html');
  console.log('Starting recording...');
  await recorder.start('search_plugin_demo_full.mp4');

  const delay = ms => new Promise(res => setTimeout(res, ms));

  console.log('1. Click to show idle dropdown');
  await page.click('#searchInput');
  await delay(2000);

  console.log('2. Type "cleaning"');
  await page.type('#searchInput', 'cleaning', { delay: 100 });
  await delay(2000);

  await page.evaluate(() => { document.getElementById('searchInput').value = ''; });
  await page.click('#searchInput');
  await delay(500);

  console.log('3. Type "deep home cleaning"');
  await page.type('#searchInput', 'deep home cleaning', { delay: 100 });
  await delay(2000);

  await page.evaluate(() => { document.getElementById('searchInput').value = ''; });
  await page.click('#searchInput');
  await delay(500);

  console.log('4. Type "wdeding" (typo)');
  await page.type('#searchInput', 'wdeding', { delay: 100 });
  await delay(2000);

  console.log('5. Select first suggestion and enter results view');
  try {
    await page.waitForSelector('.dd-item', { timeout: 2000 });
    const items = await page.$$('.dd-item');
    if (items.length > 0) {
      await items[0].click();
      await delay(500);
      await page.click('#searchBtn'); // Actually trigger the search!
    } else {
      await page.keyboard.press('Enter');
    }
  } catch (e) {
    await page.click('#searchBtn');
  }
  
  // Wait for results overlay to be active and results to load
  await page.waitForSelector('#hamburgerBtn', { visible: true, timeout: 5000 });
  await delay(2000); // Give the animation time to finish
  
  console.log('6. Open Filters Drawer');
  await page.click('#hamburgerBtn');
  await delay(1500);

  console.log('7. Apply filters');
  try {
    const radioRows = await page.$$('.radio-row');
    if (radioRows.length > 1) await radioRows[1].click(); // Highest Rated
    await delay(1000);
    
    const chips = await page.$$('.chip');
    if (chips.length > 4) await chips[4].click(); // 4.0+ rating
    await delay(1000);

    // Apply filters
    await page.click('#applyFiltersBtn');
    await delay(2500);
  } catch (e) {
    console.error("Filter click error:", e);
  }

  console.log('8. Scroll results');
  await page.evaluate(() => {
    document.getElementById('resultsBody').scrollBy({ top: 300, behavior: 'smooth' });
  });
  await delay(2000);

  console.log('9. Go back');
  try {
    await page.click('#backBtn');
  } catch (e) {}
  await delay(1500);

  console.log('10. Clear and show history');
  await page.evaluate(() => { document.getElementById('searchInput').value = ''; });
  await page.click('#searchInput');
  await delay(3000);

  console.log('Stopping recording...');
  await recorder.stop();
  await browser.close();
  console.log('Video recording saved as search_plugin_demo_full.mp4');
})();
