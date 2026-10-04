/**
 * Scroll reveal: content plays a short entrance the first time it comes into view.
 *
 * State lives in a `data-reveal` attribute rather than a class, because React rewrites
 * `className` on re-render. Nothing is hidden unless this runs, so without script,
 * without IntersectionObserver, or with reduced motion, everything is simply visible.
 */
const GROUPS: Record<string, string> = {
  grow: '.garden-seed, .forest-plant',
  slide: '.timeline > li, .account-list > li, .seed-row, .account-table tbody tr, .ask-context-card',
  rise: '.page-heading, .meeting-summary, .section-heading, .plot-heading, .account-toolbar, .grove-toolbar, .ask-box, '
    + '.ask-context, .leaves, .workspace-extension > section, .ingest-panel section, .ingest-panel article, '
    + '.workspace-footer',
  rule: '.account-section',
};

export function startScrollReveal(): () => void {
  if (typeof IntersectionObserver === 'undefined' || typeof MutationObserver === 'undefined'
    || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return () => {};

  const observer = new IntersectionObserver((entries) => {
    // Elements arriving together follow one another instead of moving as a block.
    let order = 0;
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const element = entry.target as HTMLElement;
      element.style.setProperty('--reveal-delay', `${Math.min(order++, 9) * 70}ms`);
      element.dataset.reveal = 'shown';
      observer.unobserve(element);
    }
  }, { rootMargin: '0px 0px -6% 0px', threshold: .08 });

  const tag = () => {
    for (const [kind, selector] of Object.entries(GROUPS)) {
      document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
        if (element.dataset.reveal) return;
        element.dataset.reveal = 'pending';
        element.dataset.revealKind = kind;
        observer.observe(element);
      });
    }
  };
  tag();
  let queued = false;
  const mutations = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; tag(); });
  });
  mutations.observe(document.body, { childList: true, subtree: true });
  return () => { observer.disconnect(); mutations.disconnect(); };
}
