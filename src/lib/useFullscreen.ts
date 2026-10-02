import { useCallback, useEffect, useState, type RefObject } from 'react';

/**
 * Full-screen mode for one element. Uses the browser Fullscreen API where it's
 * available; `full` also drives a CSS fallback that fills the window, so it
 * still works where the API isn't (e.g. iPhone Safari).
 */
export function useFullscreen(ref: RefObject<HTMLElement | null>) {
  const [full, setFull] = useState(false);

  useEffect(() => {
    const onChange = () => { if (document.fullscreenElement !== ref.current) setFull(false); };
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      if (document.fullscreenElement && document.fullscreenElement === ref.current) void document.exitFullscreen().catch(() => undefined);
    };
  }, [ref]);

  const enter = useCallback(() => {
    setFull(true);
    const el = ref.current;
    // must be called synchronously inside the click/keypress that asked for it
    if (el?.requestFullscreen && !document.fullscreenElement) el.requestFullscreen().catch(() => undefined);
  }, [ref]);

  const exit = useCallback(() => {
    setFull(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  }, []);

  const toggle = useCallback(() => (full ? exit() : enter()), [full, enter, exit]);
  return { full, toggle, exit };
}
