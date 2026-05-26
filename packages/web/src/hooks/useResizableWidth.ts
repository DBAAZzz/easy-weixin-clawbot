import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";

export interface UseResizableWidthOptions {
  collapsedThreshold?: number;
  defaultWidth: number;
  keyboardStep?: number;
  maxWidth: number;
  minWidth: number;
  storageKey?: string;
}

export interface ResizeHandleProps {
  "aria-valuemax": number;
  "aria-valuemin": number;
  "aria-valuenow": number;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onMouseDown: (event: MouseEvent<HTMLButtonElement>) => void;
  role: "separator";
}

function clampWidth(width: number, minWidth: number, maxWidth: number) {
  return Math.min(maxWidth, Math.max(minWidth, Math.round(width)));
}

function getStoredWidth(storageKey: string | undefined) {
  if (!storageKey || typeof window === "undefined") {
    return undefined;
  }

  const width = Number(window.localStorage.getItem(storageKey));
  return Number.isFinite(width) ? width : undefined;
}

export function useResizableWidth({
  collapsedThreshold,
  defaultWidth,
  keyboardStep = 16,
  maxWidth,
  minWidth,
  storageKey,
}: UseResizableWidthOptions) {
  const dragStateRef = useRef<{ startWidth: number; startX: number } | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [width, setWidthState] = useState(() =>
    clampWidth(getStoredWidth(storageKey) ?? defaultWidth, minWidth, maxWidth),
  );

  const setWidth = useCallback(
    (nextWidth: number) => {
      setWidthState(clampWidth(nextWidth, minWidth, maxWidth));
    },
    [maxWidth, minWidth],
  );

  useEffect(() => {
    if (!storageKey || typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(storageKey, String(width));
  }, [storageKey, width]);

  useEffect(() => {
    if (!isResizing) {
      return undefined;
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    function resize(event: globalThis.MouseEvent) {
      const dragState = dragStateRef.current;
      if (!dragState) {
        return;
      }

      setWidth(dragState.startWidth + event.clientX - dragState.startX);
    }

    function stopResize() {
      dragStateRef.current = null;
      setIsResizing(false);
    }

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", resize);
    document.addEventListener("mouseup", stopResize);

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      document.removeEventListener("mousemove", resize);
      document.removeEventListener("mouseup", stopResize);
    };
  }, [isResizing, setWidth]);

  const startResize = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      dragStateRef.current = {
        startWidth: width,
        startX: event.clientX,
      };
      setIsResizing(true);
    },
    [width],
  );

  const resizeWithKeyboard = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setWidth(width - keyboardStep);
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        setWidth(width + keyboardStep);
      }

      if (event.key === "Home") {
        event.preventDefault();
        setWidth(minWidth);
      }

      if (event.key === "End") {
        event.preventDefault();
        setWidth(maxWidth);
      }
    },
    [keyboardStep, maxWidth, minWidth, setWidth, width],
  );

  return {
    isCollapsed: collapsedThreshold === undefined ? false : width <= collapsedThreshold,
    isResizing,
    resizeHandleProps: {
      "aria-valuemax": maxWidth,
      "aria-valuemin": minWidth,
      "aria-valuenow": width,
      onKeyDown: resizeWithKeyboard,
      onMouseDown: startResize,
      role: "separator" as const,
    } satisfies ResizeHandleProps,
    setWidth,
    width,
  };
}
