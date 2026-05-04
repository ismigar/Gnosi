const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => {
      // Ignore routine logs
      if (!msg.text().includes('Initializing Sigma') && !msg.text().includes('GraphViewer:')) return;
      console.log('BROWSER LOG:', msg.text());
  });
  page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));

  console.log('Navigating to http://localhost:5173/graph ...');
  try {
      await page.goto('http://localhost:5173/graph', { waitUntil: 'networkidle', timeout: 30000 });
      console.log('Got to page. Waiting 4 seconds for rendering/physics...');
      await page.waitForTimeout(4000);
      
      const isCanvasVisible = await page.evaluate(() => {
         const rendererContainer = document.querySelector('.sigma-mouse');
         return !!rendererContainer;
      });
      const reactErrors = await page.evaluate(() => {
         return document.body.innerText.includes('An error occurred in the');
      });
      console.log('Is Sigma Canvas rendered?', isCanvasVisible);
      console.log('Are there React boundary errors?', reactErrors);
  } catch(e) {
      console.log('Error navigating:', e.message);
  }
  await browser.close();
})();
