// The paving pair under "Czyszczenie bruku": the "Po" photo starts out as the
// grey "Przed" one and washes clean from the top the first time it comes into
// view. A click or tap runs the pass again. Without JS, or with reduced motion,
// both photos simply show.
export function setupProof(figure, { still }) {
  const frame = figure?.querySelector('.proof__after');
  if (!frame || still || !('IntersectionObserver' in window)) return;
  const clean = frame.querySelector('.proof__clean');
  const track = frame.querySelector('.proof__track');

  figure.classList.add('is-armed');

  function run() {
    figure.classList.add('is-armed');
    figure.classList.remove('is-washed', 'is-done');
    void frame.offsetWidth;
    figure.classList.add('is-washed');
  }

  track.addEventListener('transitionend', (e) => {
    if (e.propertyName === 'transform') figure.classList.add('is-done');
  });

  // A fully clipped lazy image never counts as near the screen, so fetch it
  // by hand a screen ahead, or the wash would wait for the download
  const near = new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) return;
    near.disconnect();
    clean.loading = 'eager';
  }, { rootMargin: '0px 0px 100% 0px' });
  near.observe(frame);

  const seen = new IntersectionObserver(([entry]) => {
    if (entry.intersectionRatio >= 0.6) {
      seen.disconnect();
      clean.decode().catch(() => {}).then(() => setTimeout(run, 250));
    } else if (!entry.isIntersecting && entry.boundingClientRect.top < 0) {
      // Scrolled past it, or arrived lower down the page: just show it clean
      seen.disconnect();
      figure.classList.remove('is-armed');
    }
  }, { threshold: [0, 0.6] });
  seen.observe(frame);

  frame.addEventListener('click', run);
}
