/** A note's scrollbar stays quiet until hovered or scrolling (Nov 2026 review: the pale blue bar ran down between
 *  the note and the slim side panel and read as a divider line down the middle of a wide window). The CSS keeps the
 *  thumb transparent; this marks the scroller .is-scrolling while it moves — however the scroll starts (wheel,
 *  keyboard, drag, jump) — and unmarks it 900ms after the last movement, so the bar shows while scrolling and goes
 *  quiet again at rest. Returns the detach for unmount. */
export function quietScroll(el: HTMLElement | null): () => void {
  if (!el) return () => {};
  let idle: ReturnType<typeof setTimeout> | null = null;
  const onScroll = () => {
    el.classList.add('is-scrolling');
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => {
      idle = null;
      el.classList.remove('is-scrolling');
    }, 900);
  };
  el.addEventListener('scroll', onScroll, { passive: true });
  return () => {
    el.removeEventListener('scroll', onScroll);
    if (idle) clearTimeout(idle);
    el.classList.remove('is-scrolling');
  };
}
