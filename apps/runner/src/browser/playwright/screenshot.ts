import type { Page } from "playwright";

const SCREENSHOT_PRELOAD_MAX_SCROLL_STEPS = 48;
const SCREENSHOT_PRELOAD_SCROLL_DELAY_MS = 120;
const SCREENSHOT_PRELOAD_NETWORK_IDLE_TIMEOUT_MS = 2_000;
const SCREENSHOT_PRELOAD_IMAGE_DECODE_TIMEOUT_MS = 3_000;

export async function preparePageForScreenshot(page: Page): Promise<void> {
  await triggerLazyLoadedImages(page);

  await page.waitForLoadState("networkidle", {
    timeout: SCREENSHOT_PRELOAD_NETWORK_IDLE_TIMEOUT_MS
  }).catch(() => undefined);

  await waitForImageDecode(page);
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
