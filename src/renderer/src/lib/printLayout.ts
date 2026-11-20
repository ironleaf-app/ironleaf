/** One laid-out page for every print path (9.2 uplift F9): Export to PDF and the share PDF lay out through
 *  here, so one unreachable picture can never hang either — each waits at most 8 seconds, then prints on. */

/** Pictures settled, each waiting at most 8 seconds: a picture that never loads prints as its empty frame. */
export async function settleImages(root: ParentNode): Promise<void> {
  await Promise.all(
    [...root.querySelectorAll('img')].map((img) =>
      img.complete
        ? null
        : new Promise((r) => {
            img.onload = r;
            img.onerror = r;
            window.setTimeout(r, 8000);
          }),
    ),
  );
}

/** The page laid out for print: title plus body under `.print-root`, pictures settled, printing flagged on.
 *  Returns the put-away, which flags off and removes the page. */
export async function layOutForPrint(opts: { titleHtml: string; bodyHtml: string; extraClass?: string }): Promise<() => void> {
  const { hydrate } = await import('./hydrate');
  const root = document.createElement('div');
  root.className = `print-root markdown${opts.extraClass ? ` ${opts.extraClass}` : ''}`;
  root.innerHTML = `${opts.titleHtml}${opts.bodyHtml}`;
  document.body.appendChild(root);
  await hydrate(root);
  await settleImages(root);
  document.body.classList.add('is-printing');
  return () => {
    document.body.classList.remove('is-printing');
    root.remove();
  };
}
