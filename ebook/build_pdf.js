// ebook/index.html → ebook/ai-short-drama-ebook.pdf
// 사용법: node ebook/build_pdf.js   (Playwright + Chromium 필요)
const path = require("path");
const { chromium } = require("playwright");

(async () => {
  const here = __dirname;
  const src = "file://" + path.join(here, "index.html");
  const out = path.join(here, "ai-short-drama-ebook.pdf");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.emulateMedia({ media: "print", colorScheme: "light" });
  await page.goto(src, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({
    path: out,
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate:
      '<div style="width:100%;text-align:center;font-size:9px;color:#777;font-family:sans-serif">' +
      'AI 숏드라마, 한 편을 끝까지 · 초안 · <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    margin: { top: "18mm", right: "16mm", bottom: "20mm", left: "16mm" },
  });
  await browser.close();
  console.log("wrote", out);
})();
