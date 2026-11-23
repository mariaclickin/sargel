'use strict';
/*
 * End-of-day celebration: confetti fired from both sides of the screen for ~2 seconds, in Sargel's colours.
 * Runs in a see-through, click-through window that main.js shows on top and closes a few seconds later.
 */
(function () {
  const fire = window.confetti.create(document.getElementById('c'), {
    resize: true,
    useWorker: false, // the page's CSP has no room for a blob: worker
    disableForReducedMotion: true,
  });
  const colors = ['#6a45ff', '#9d5cff', '#F29CBF', '#9AC4F8', '#ffffff'];
  const end = Date.now() + 2000;
  (function frame() {
    fire({ particleCount: 3, angle: 60, spread: 55, startVelocity: 60, origin: { x: 0, y: 0.6 }, colors });
    fire({ particleCount: 3, angle: 120, spread: 55, startVelocity: 60, origin: { x: 1, y: 0.6 }, colors });
    if (Date.now() < end) requestAnimationFrame(frame);
  }());
}());
