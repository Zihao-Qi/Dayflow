import {
  expect,
  test,
  type APIRequestContext
} from "@playwright/test";

const installIcons = [
  {
    src: "/icons/dayflow-192.png",
    sizes: "192x192",
    type: "image/png",
    purpose: "any"
  },
  {
    src: "/icons/dayflow-512.png",
    sizes: "512x512",
    type: "image/png",
    purpose: "any"
  },
  {
    src: "/icons/dayflow-maskable-512.png",
    sizes: "512x512",
    type: "image/png",
    purpose: "maskable"
  }
] as const;

function pngDimensions(bytes: Buffer) {
  const signature = Buffer.from("89504e470d0a1a0a", "hex");
  if (
    bytes.length < 24 ||
    !bytes.subarray(0, 8).equals(signature) ||
    bytes.subarray(12, 16).toString("ascii") !== "IHDR"
  ) {
    throw new Error("Response is not a valid PNG with an IHDR chunk.");
  }

  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20)
  };
}

async function expectPng(
  request: APIRequestContext,
  path: string,
  size: number
) {
  const response = await request.get(path);
  expect(response.status(), path).toBe(200);
  expect(response.headers()["content-type"], path).toMatch(
    /^image\/png(?:;|$)/
  );
  expect(pngDimensions(await response.body()), path).toEqual({
    width: size,
    height: size
  });
}

test("publishes the Dayflow installability manifest", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");

  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(
    /^application\/manifest\+json(?:;|$)/
  );

  const manifest = (await response.json()) as {
    id?: string;
    name?: string;
    short_name?: string;
    lang?: string;
    description?: string;
    start_url?: string;
    scope?: string;
    display?: string;
    background_color?: string;
    theme_color?: string;
    prefer_related_applications?: boolean;
    icons?: Array<{
      src: string;
      sizes: string;
      type: string;
      purpose?: string;
    }>;
  };

  expect(manifest).toMatchObject({
    id: "/",
    name: "Dayflow",
    short_name: "Dayflow",
    lang: "en",
    description:
      "A local-first personal workspace for deciding, planning, recording, capturing, and reviewing.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f8f6f0",
    theme_color: "#f8f6f0",
    prefer_related_applications: false
  });
  expect(manifest.icons).toEqual(installIcons);
});

test("serves every declared install icon at its honest size", async ({
  request
}) => {
  for (const icon of installIcons) {
    const [width, height] = icon.sizes.split("x").map(Number);
    expect(width).toBe(height);
    await expectPng(request, icon.src, width);
  }
});

test("advertises install metadata from the rendered document head", async ({
  page,
  request
}) => {
  await page.goto("/");

  await expect(page.locator('head link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest.webmanifest"
  );
  await expect(
    page.locator('head meta[name="application-name"]')
  ).toHaveAttribute("content", "Dayflow");
  await expect(page.locator('head meta[name="theme-color"]')).toHaveAttribute(
    "content",
    "#f8f6f0"
  );
  await expect(
    page.locator('head meta[name="mobile-web-app-capable"]')
  ).toHaveAttribute("content", "yes");
  await expect(
    page.locator('head meta[name="apple-mobile-web-app-capable"]')
  ).toHaveAttribute("content", "yes");
  await expect(
    page.locator('head meta[name="apple-mobile-web-app-title"]')
  ).toHaveAttribute("content", "Dayflow");
  await expect(
    page.locator('head meta[name="apple-mobile-web-app-status-bar-style"]')
  ).toHaveAttribute("content", "default");

  const icon = page.locator(
    'head link[rel="icon"][href="/icons/dayflow-32.png"]'
  );
  await expect(icon).toHaveAttribute("type", "image/png");
  await expect(icon).toHaveAttribute("sizes", "32x32");

  const appleIcon = page.locator(
    'head link[rel="apple-touch-icon"][href="/icons/dayflow-apple-touch.png"]'
  );
  await expect(appleIcon).toHaveAttribute("type", "image/png");
  await expect(appleIcon).toHaveAttribute("sizes", "180x180");

  await expectPng(request, "/icons/dayflow-32.png", 32);
  await expectPng(request, "/icons/dayflow-apple-touch.png", 180);

  const cdp = await page.context().newCDPSession(page);
  const discoveredManifest = await cdp.send("Page.getAppManifest");
  expect(discoveredManifest.url).toBe(
    "http://127.0.0.1:3100/manifest.webmanifest"
  );
  expect(discoveredManifest.errors).toEqual([]);
});
