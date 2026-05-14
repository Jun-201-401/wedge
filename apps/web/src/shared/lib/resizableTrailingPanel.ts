import {
  useCallback,
  useLayoutEffect,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from 'react';

interface ResizableTrailingPanelOptions {
  defaultWidth: number;
  defaultRatio: number;
  minWidth: number;
  maxWidth: number;
  leadMinWidth: number;
  resizeStep: number;
  resizerFallbackWidth: number;
  resizerSelector: string;
  resetKey: string | number | boolean;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getResizablePanelBounds(
  container: HTMLElement | null,
  minWidth: number,
  maxWidth: number,
  defaultWidth: number,
  leadMinWidth: number,
) {
  if (!container) {
    return {
      min: minWidth,
      max: Math.max(minWidth, Math.min(maxWidth, defaultWidth)),
    };
  }

  const availableWidth = container.getBoundingClientRect().width;
  const maxByLeadWidth = Math.max(minWidth, availableWidth - leadMinWidth);
  const boundedMaxWidth = Math.max(minWidth, Math.min(maxWidth, maxByLeadWidth));

  return {
    min: minWidth,
    max: boundedMaxWidth,
  };
}

function getPanelResizerWidth(container: HTMLElement, selector: string, fallbackWidth: number) {
  return container.querySelector<HTMLElement>(selector)?.getBoundingClientRect().width ?? fallbackWidth;
}

function getDefaultPanelWidth(container: HTMLElement | null, options: ResizableTrailingPanelOptions) {
  const bounds = getResizablePanelBounds(
    container,
    options.minWidth,
    options.maxWidth,
    options.defaultWidth,
    options.leadMinWidth,
  );
  if (!container) {
    return clampNumber(options.defaultWidth, bounds.min, bounds.max);
  }

  const availableWidth = container.getBoundingClientRect().width;
  const visibleWidth = Math.max(0, availableWidth - getPanelResizerWidth(container, options.resizerSelector, options.resizerFallbackWidth));
  const ratioWidth = Math.round(visibleWidth * options.defaultRatio);
  return clampNumber(ratioWidth, bounds.min, bounds.max);
}

export function useResizableTrailingPanel(
  containerRef: RefObject<HTMLElement | null>,
  options: ResizableTrailingPanelOptions,
) {
  const {
    defaultWidth,
    defaultRatio,
    minWidth,
    maxWidth,
    leadMinWidth,
    resizeStep,
    resizerFallbackWidth,
    resizerSelector,
    resetKey,
  } = options;
  const [panelWidth, setPanelWidth] = useState(defaultWidth);

  const updatePanelWidth = useCallback((nextWidth: number) => {
    const bounds = getResizablePanelBounds(
      containerRef.current,
      minWidth,
      maxWidth,
      defaultWidth,
      leadMinWidth,
    );
    setPanelWidth(clampNumber(nextWidth, bounds.min, bounds.max));
  }, [containerRef, defaultWidth, leadMinWidth, maxWidth, minWidth]);

  const updatePanelWidthFromPointer = useCallback((clientX: number) => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const rect = container.getBoundingClientRect();
    updatePanelWidth(rect.right - clientX);
  }, [containerRef, updatePanelWidth]);

  const handleResizePointerDown = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    updatePanelWidthFromPointer(event.clientX);
  }, [updatePanelWidthFromPointer]);

  const handleResizePointerMove = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    if (event.buttons !== 1) {
      return;
    }

    updatePanelWidthFromPointer(event.clientX);
  }, [updatePanelWidthFromPointer]);

  const handleResizeKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      updatePanelWidth(panelWidth + resizeStep);
      return;
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      updatePanelWidth(panelWidth - resizeStep);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      updatePanelWidth(getDefaultPanelWidth(containerRef.current, {
        defaultRatio,
        defaultWidth,
        leadMinWidth,
        maxWidth,
        minWidth,
        resetKey,
        resizeStep,
        resizerFallbackWidth,
        resizerSelector,
      }));
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      updatePanelWidth(minWidth);
    }
  }, [
    containerRef,
    defaultRatio,
    defaultWidth,
    leadMinWidth,
    maxWidth,
    minWidth,
    panelWidth,
    resetKey,
    resizeStep,
    resizerFallbackWidth,
    resizerSelector,
    updatePanelWidth,
  ]);

  useLayoutEffect(() => {
    if (!containerRef.current) {
      return;
    }

    setPanelWidth(getDefaultPanelWidth(containerRef.current, {
      defaultRatio,
      defaultWidth,
      leadMinWidth,
      maxWidth,
      minWidth,
      resetKey,
      resizeStep,
      resizerFallbackWidth,
      resizerSelector,
    }));
  }, [
    containerRef,
    defaultRatio,
    defaultWidth,
    leadMinWidth,
    maxWidth,
    minWidth,
    resetKey,
    resizeStep,
    resizerFallbackWidth,
    resizerSelector,
  ]);

  return {
    panelWidth,
    handleResizeKeyDown,
    handleResizePointerDown,
    handleResizePointerMove,
  };
}
