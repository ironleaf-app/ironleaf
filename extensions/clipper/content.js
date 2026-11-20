// Reading the open page for a clip (injected into the tab only when clipping, never sitting in pages): the page's
// own facts, its HTML for the article, the marked part, and its pictures' addresses. The Vault does the reading
// (src/shared/clipper.ts); this only gathers. Classic script (no imports): loaded by the worker on demand.
(function () {
  if (window.__nvaultClipper) return;
  window.__nvaultClipper = true;

  const meta = (attr, name) => {
    const el = document.querySelector(`meta[${attr}="${name}"]`);
    return (el && el.getAttribute('content') || '').trim();
  };
  const absolute = (raw) => {
    try {
      const u = new URL(String(raw || '').trim(), location.href);
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
    } catch {
      return '';
    }
  };

  chrome.runtime.onMessage.addListener((msg, _sender, send) => {
    if (!msg || msg.kind !== 'nvault-collect') return;
    if (location.protocol !== 'http:' && location.protocol !== 'https:') {
      send({ error: 'Only ordinary web pages can be clipped.' });
      return;
    }
    const sel = window.getSelection();
    let selection = null;
    if (sel && !sel.isCollapsed && sel.rangeCount > 0 && sel.toString().trim()) {
      const div = document.createElement('div');
      try {
        div.appendChild(sel.getRangeAt(0).cloneContents());
      } catch {
        // A strange selection: its words still come through below.
      }
      selection = { html: div.innerHTML.slice(0, 1000000), text: sel.toString().slice(0, 200000) };
    }
    const images = [];
    const seen = new Set();
    for (const img of document.images) {
      const src = absolute(img.currentSrc || img.src);
      if (!src || seen.has(src)) continue;
      seen.add(src);
      images.push(src);
      if (images.length >= 30) break;
    }
    send({
      url: location.href,
      title: document.title || '',
      description: meta('property', 'og:description') || meta('name', 'description'),
      image: absolute(meta('property', 'og:image')),
      author: meta('property', 'article:author') || meta('name', 'author'),
      published: meta('property', 'article:published_time') || meta('name', 'date'),
      site: meta('property', 'og:site_name'),
      html: document.documentElement.outerHTML.slice(0, 4 * 1024 * 1024),
      images,
      selection,
    });
  });
})();
