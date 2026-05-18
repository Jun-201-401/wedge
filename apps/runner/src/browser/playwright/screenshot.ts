import type { Page } from "playwright";

const SCREENSHOT_PRELOAD_MAX_SCROLL_STEPS = 48;
const SCREENSHOT_PRELOAD_SCROLL_DELAY_MS = 120;
const SCREENSHOT_PRELOAD_NETWORK_IDLE_TIMEOUT_MS = 2_000;
const SCREENSHOT_PRELOAD_IMAGE_DECODE_TIMEOUT_MS = 3_000;
const VIEWPORT_STITCH_SCROLL_DELAY_MS = 180;
const VIEWPORT_STITCH_MAX_TILES = 80;
const VIEWPORT_STITCH_MAX_CANVAS_EDGE_PX = 32_000;
const VIEWPORT_STITCH_STYLE_ID = "wedge-viewport-stitch-capture-style";
const VIEWPORT_STITCH_FIXED_ATTR = "data-wedge-viewport-stitch-fixed";
const AUTO_LONG_PAGE_VIEWPORT_RATIO = 3;

export type ScreenshotMode = "auto" | "viewport" | "full_page" | "viewport_stitched";
export interface ScreenshotCaptureResult {
  buffer: Buffer;
  mode: Exclude<ScreenshotMode, "auto">;
}

export async function capturePageScreenshot(page: Page, mode: ScreenshotMode): Promise<ScreenshotCaptureResult> {
  if (mode === "auto") {
    return capturePageScreenshot(page, await resolveAutoScreenshotMode(page));
  }

  if (mode === "viewport") {
    return {
      buffer: await page.screenshot({
        type: "png",
        fullPage: false
      }),
      mode
    };
  }

  if (mode === "viewport_stitched") {
    return {
      buffer: await captureViewportStitchedScreenshot(page),
      mode
    };
  }

  return {
    buffer: await captureFullPageScreenshot(page),
    mode
  };
}

async function resolveAutoScreenshotMode(page: Page): Promise<Exclude<ScreenshotMode, "auto">> {
  const viewport = page.viewportSize();
  if (!viewport) {
    return "full_page";
  }

  const metrics = await readPageMetrics(page, viewport).catch(() => null);
  if (!metrics) {
    return "full_page";
  }

  const pageLengthRatio = metrics.scrollHeight / Math.max(metrics.viewportHeight, 1);
  return pageLengthRatio > AUTO_LONG_PAGE_VIEWPORT_RATIO ? "viewport_stitched" : "full_page";
}

export async function preparePageForScreenshot(page: Page): Promise<void> {
  await triggerLazyLoadedImages(page);

  await page.waitForLoadState("networkidle", {
    timeout: SCREENSHOT_PRELOAD_NETWORK_IDLE_TIMEOUT_MS
  }).catch(() => undefined);

  await waitForImageDecode(page);
}

async function captureViewportStitchedScreenshot(page: Page): Promise<Buffer> {
  const viewport = page.viewportSize();
  if (!viewport) {
    return page.screenshot({ type: "png", fullPage: true });
  }

  const originalScroll = await readScrollPosition(page);
  try {
    await installViewportStitchStyle(page);

    const metrics = await readPageMetrics(page, viewport);
    if (metrics.scrollHeight <= metrics.viewportHeight) {
      return page.screenshot({ type: "png", fullPage: false });
    }
    if (Math.ceil(metrics.scrollHeight / metrics.viewportHeight) > VIEWPORT_STITCH_MAX_TILES) {
      throw new Error("Viewport stitched screenshot exceeds tile limit.");
    }

    const positions = viewportStitchPositions(metrics.maxScrollY, metrics.viewportHeight);
    const tiles: Array<{ dataUrl: string; scrollY: number }> = [];

    for (let index = 0; index < positions.length; index += 1) {
      const requestedScrollY = positions[index]!;
      await page.evaluate((scrollY) => globalThis.scrollTo(0, scrollY), requestedScrollY);
      await page.waitForTimeout(VIEWPORT_STITCH_SCROLL_DELAY_MS);
      await waitForImageDecode(page);

      if (index > 0) {
        await hideVisibleFixedOrStickyElements(page);
      }

      const actualScrollY = await page.evaluate(() => globalThis.scrollY);
      const buffer = await page.screenshot({
        type: "png",
        fullPage: false
      });
      tiles.push({
        dataUrl: `data:image/png;base64,${buffer.toString("base64")}`,
        scrollY: actualScrollY
      });
    }

    return await stitchViewportTiles(page, {
      tiles,
      scrollHeight: metrics.scrollHeight,
      viewportWidth: metrics.viewportWidth
    });
  } catch {
    return page.screenshot({ type: "png", fullPage: true });
  } finally {
    await restoreViewportStitchState(page, originalScroll);
  }
}

async function captureFullPageScreenshot(page: Page): Promise<Buffer> {
  const originalScroll = await readScrollPosition(page);
  try {
    return await page.screenshot({
      type: "png",
      fullPage: true
    });
  } finally {
    await restoreScrollPosition(page, originalScroll);
  }
}

async function readScrollPosition(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => ({
    x: globalThis.scrollX,
    y: globalThis.scrollY
  })).catch(() => ({ x: 0, y: 0 }));
}

async function installViewportStitchStyle(page: Page): Promise<void> {
  await page.evaluate(({ styleId, fixedAttr }) => {
    globalThis.document.getElementById(styleId)?.remove();
    const style = globalThis.document.createElement("style");
    style.id = styleId;
    style.textContent = `
      html { scroll-behavior: auto !important; }
      *, *::before, *::after {
        animation-delay: 0s !important;
        animation-duration: 0s !important;
        animation-play-state: paused !important;
        transition-duration: 0s !important;
        scroll-behavior: auto !important;
      }
      [${fixedAttr}="hidden"] {
        visibility: hidden !important;
      }
    `;
    globalThis.document.documentElement.appendChild(style);
  }, {
    styleId: VIEWPORT_STITCH_STYLE_ID,
    fixedAttr: VIEWPORT_STITCH_FIXED_ATTR
  }).catch(() => undefined);
}

async function readPageMetrics(
  page: Page,
  viewport: { width: number; height: number }
): Promise<{
  scrollHeight: number;
  viewportHeight: number;
  viewportWidth: number;
  maxScrollY: number;
}> {
  return page.evaluate((fallbackViewport) => {
    const viewportHeight = Math.max(globalThis.innerHeight || 0, fallbackViewport.height);
    const viewportWidth = Math.max(globalThis.innerWidth || 0, fallbackViewport.width);
    const documentElement = globalThis.document.documentElement;
    const body = globalThis.document.body;
    const scrollHeight = Math.max(
      documentElement.scrollHeight,
      body?.scrollHeight ?? 0,
      viewportHeight
    );

    return {
      scrollHeight,
      viewportHeight,
      viewportWidth,
      maxScrollY: Math.max(0, scrollHeight - viewportHeight)
    };
  }, viewport);
}

function viewportStitchPositions(maxScrollY: number, viewportHeight: number): number[] {
  const positions: number[] = [];
  for (let scrollY = 0; scrollY < maxScrollY && positions.length < VIEWPORT_STITCH_MAX_TILES; scrollY += viewportHeight) {
    positions.push(scrollY);
  }

  if (positions.at(-1) !== maxScrollY && positions.length < VIEWPORT_STITCH_MAX_TILES) {
    positions.push(maxScrollY);
  }

  return [...new Set(positions.map((position) => Math.max(0, Math.floor(position))))];
}

async function hideVisibleFixedOrStickyElements(page: Page): Promise<void> {
  await page.evaluate((fixedAttr) => {
    for (const element of Array.from(globalThis.document.querySelectorAll<HTMLElement>("body *"))) {
      const style = globalThis.getComputedStyle(element);
      if (style.position !== "fixed" && style.position !== "sticky") {
        continue;
      }

      const rect = element.getBoundingClientRect();
      const visible = rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < globalThis.innerHeight &&
        rect.left < globalThis.innerWidth;

      if (visible) {
        element.setAttribute(fixedAttr, "hidden");
      }
    }
  }, VIEWPORT_STITCH_FIXED_ATTR).catch(() => undefined);
}

async function stitchViewportTiles(
  page: Page,
  input: {
    tiles: Array<{ dataUrl: string; scrollY: number }>;
    scrollHeight: number;
    viewportWidth: number;
  }
): Promise<Buffer> {
  const dataUrl = await page.evaluate(async ({ tiles, scrollHeight, viewportWidth, maxCanvasEdge }) => {
    const images = await Promise.all(tiles.map((tile) => loadImage(tile.dataUrl)));
    const firstImage = images[0];
    if (!firstImage) {
      throw new Error("No viewport tiles were captured.");
    }

    const scale = firstImage.naturalWidth / viewportWidth;
    const canvasWidth = firstImage.naturalWidth;
    const canvasHeight = Math.ceil(scrollHeight * scale);
    if (canvasWidth > maxCanvasEdge || canvasHeight > maxCanvasEdge) {
      throw new Error("Stitched screenshot exceeds browser canvas limits.");
    }

    const canvas = globalThis.document.createElement("canvas");
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas 2D context is unavailable.");
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);

    for (let index = 0; index < images.length; index += 1) {
      const image = images[index]!;
      const tile = tiles[index]!;
      const destinationY = Math.round(tile.scrollY * scale);
      context.drawImage(image, 0, destinationY);
    }

    return canvas.toDataURL("image/png");

    function loadImage(src: string): Promise<HTMLImageElement> {
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Failed to load viewport tile."));
        image.src = src;
      });
    }
  }, {
    ...input,
    maxCanvasEdge: VIEWPORT_STITCH_MAX_CANVAS_EDGE_PX
  });

  const encoded = dataUrl.split(",", 2)[1];
  if (!encoded) {
    throw new Error("Stitched screenshot did not return PNG data.");
  }
  return Buffer.from(encoded, "base64");
}

async function restoreViewportStitchState(
  page: Page,
  originalScroll: { x: number; y: number }
): Promise<void> {
  await page.evaluate(({ fixedAttr, scroll, styleId }) => {
    globalThis.document.getElementById(styleId)?.remove();
    for (const element of Array.from(globalThis.document.querySelectorAll(`[${fixedAttr}]`))) {
      element.removeAttribute(fixedAttr);
    }
    globalThis.scrollTo(scroll.x, scroll.y);
  }, {
    fixedAttr: VIEWPORT_STITCH_FIXED_ATTR,
    styleId: VIEWPORT_STITCH_STYLE_ID,
    scroll: originalScroll
  }).catch(() => undefined);
}

async function restoreScrollPosition(
  page: Page,
  originalScroll: { x: number; y: number }
): Promise<void> {
  await page.evaluate((scroll) => {
    globalThis.scrollTo(scroll.x, scroll.y);
  }, originalScroll).catch(() => undefined);
}

async function triggerLazyLoadedImages(page: Page): Promise<void> {
  await page.evaluate(
    async ({ maxScrollSteps, scrollDelayMs }) => {
      const delay = (ms: number) => new Promise<void>((resolve) => globalThis.setTimeout(resolve, ms));
      const originalScrollX = globalThis.scrollX;
      const originalScrollY = globalThis.scrollY;
      const viewportHeight = Math.max(globalThis.innerHeight, 600);
      const scrollStep = Math.max(Math.floor(viewportHeight * 0.8), 600);
      const scrollHeight = Math.max(
        globalThis.document.documentElement.scrollHeight,
        globalThis.document.body?.scrollHeight ?? 0,
        viewportHeight
      );
      const maxScrollY = Math.max(0, scrollHeight - viewportHeight);
      const positions = new Set<number>([0, maxScrollY]);

      for (let scrollY = 0; scrollY <= maxScrollY && positions.size < maxScrollSteps; scrollY += scrollStep) {
        positions.add(Math.min(scrollY, maxScrollY));
      }

      for (const scrollY of [...positions].sort((left, right) => left - right)) {
        globalThis.scrollTo(originalScrollX, scrollY);
        await delay(scrollDelayMs);
      }

      globalThis.scrollTo(originalScrollX, originalScrollY);
      await delay(scrollDelayMs);
    },
    {
      maxScrollSteps: SCREENSHOT_PRELOAD_MAX_SCROLL_STEPS,
      scrollDelayMs: SCREENSHOT_PRELOAD_SCROLL_DELAY_MS
    }
  ).catch(() => undefined);
}

async function waitForImageDecode(page: Page): Promise<void> {
  await page.evaluate(
    async ({ timeoutMs }) => {
      const imageDecodePromises = Array.from(globalThis.document.images)
        .filter((image) => Boolean(image.currentSrc || image.src) && (!image.complete || image.naturalWidth === 0))
        .map(async (image) => {
          if (typeof image.decode === "function") {
            await image.decode().catch(() => undefined);
            return;
          }

          await new Promise<void>((resolve) => {
            image.addEventListener("load", () => resolve(), { once: true });
            image.addEventListener("error", () => resolve(), { once: true });
          });
        });

      if (imageDecodePromises.length === 0) {
        return;
      }

      await Promise.race([
        Promise.allSettled(imageDecodePromises),
        new Promise<void>((resolve) => globalThis.setTimeout(resolve, timeoutMs))
      ]);
    },
    {
      timeoutMs: SCREENSHOT_PRELOAD_IMAGE_DECODE_TIMEOUT_MS
    }
  ).catch(() => undefined);
}
