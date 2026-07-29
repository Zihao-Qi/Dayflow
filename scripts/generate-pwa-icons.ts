import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const repositoryRoot = process.cwd();
const outputDirectory = join(repositoryRoot, "public", "icons");

const colors = {
  canvas: "#f8f6f0",
  ink: "#25231f",
  paper: "#fffdf8"
} as const;

function iconSvg(maskable: boolean) {
  const mark = maskable
    ? { x: 116, y: 116, size: 280, radius: 56 }
    : { x: 80, y: 80, size: 352, radius: 70 };

  return `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      role="img"
      aria-label="Dayflow"
    >
      <rect width="512" height="512" fill="${colors.canvas}" />
      <rect
        x="${mark.x}"
        y="${mark.y}"
        width="${mark.size}"
        height="${mark.size}"
        rx="${mark.radius}"
        fill="${colors.ink}"
      />
      <path
        fill="${colors.paper}"
        fill-rule="evenodd"
        d="
          M 168 156
          H 261
          C 322 156 360 195 360 256
          C 360 317 322 356 261 356
          H 168
          V 334
          H 194
          V 178
          H 168
          Z

          M 228 190
          V 322
          H 258
          C 300 322 326 297 326 256
          C 326 215 300 190 258 190
          Z
        "
      />
    </svg>
  `;
}

const outputs = [
  { filename: "dayflow-32.png", size: 32, maskable: false },
  { filename: "dayflow-apple-touch.png", size: 180, maskable: false },
  { filename: "dayflow-192.png", size: 192, maskable: false },
  { filename: "dayflow-512.png", size: 512, maskable: false },
  { filename: "dayflow-maskable-512.png", size: 512, maskable: true }
] as const;

async function generateIcons() {
  mkdirSync(outputDirectory, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    for (const output of outputs) {
      const page = await browser.newPage({
        viewport: { width: output.size, height: output.size },
        deviceScaleFactor: 1,
        colorScheme: "light"
      });
      await page.setContent(
        `
          <!doctype html>
          <html>
            <head>
              <style>
                html, body {
                  width: 100%;
                  height: 100%;
                  margin: 0;
                  overflow: hidden;
                }

                svg {
                  display: block;
                  width: 100%;
                  height: 100%;
                }
              </style>
            </head>
            <body>${iconSvg(output.maskable)}</body>
          </html>
        `,
        { waitUntil: "load" }
      );
      await page.screenshot({
        path: join(outputDirectory, output.filename),
        type: "png",
        animations: "disabled"
      });
      await page.close();
    }
  } finally {
    await browser.close();
  }

  console.log(
    `Generated ${outputs.length} Dayflow PWA icons in ${outputDirectory}`
  );
}

generateIcons().catch((error: unknown) => {
  console.error("Failed to generate Dayflow PWA icons.", error);
  process.exitCode = 1;
});
