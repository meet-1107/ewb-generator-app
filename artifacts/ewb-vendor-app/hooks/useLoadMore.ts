import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Shows a long list a page at a time. `more(total)` reveals the next page
 * after a short loader; `reset()` goes back to the first page (new search or filter).
 */
export function useLoadMore(page = 20) {
  const [limit, setLimit] = useState(page);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const more = useCallback((total: number) => {
    if (timer.current || total <= limit) return;
    setLoading(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setLimit((current) => current + page);
      setLoading(false);
    }, 350);
  }, [limit, page]);

  const reset = useCallback(() => setLimit(page), [page]);

  return { limit, loading, more, reset };
}

/** True when a scroll view is within `margin` px of its end. */
export function nearEnd({ layoutMeasurement, contentOffset, contentSize }: { layoutMeasurement: { height: number }; contentOffset: { y: number }; contentSize: { height: number } }, margin = 400) {
  return layoutMeasurement.height + contentOffset.y >= contentSize.height - margin;
}
