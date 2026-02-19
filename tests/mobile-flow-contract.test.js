const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('mobile layout contract keeps key visibility and placement rules', () => {
  const html = read('public/holdem.html');
  const css = read('public/styles.css');

  // Mobile-only phase anchor must exist in table canvas.
  assert.equal(html.includes('id="mobilePhaseText"'), true);
  assert.equal(html.includes('class="status-row"'), true);

  // <=760: hide desktop status blocks, show compact phase text at top-left.
  assert.equal(css.includes('@media (max-width: 760px)'), true);
  assert.equal(css.includes('.status-row {\n    display: none;'), true);
  assert.equal(
    css.includes('.mobile-phase-text {\n    display: block;\n    position: absolute;\n    left: 8px;\n    top: 8px;'),
    true,
  );

  // Mobile launcher should be left-bottom; settings stacked above chat launcher.
  assert.equal(css.includes('.settings-launcher {\n    bottom: 60px;'), true);
  assert.equal(css.includes('.social-launcher {\n    bottom: 8px;'), true);
  assert.equal(css.includes('.social-dock {\n    left: 58px;\n    right: 8px;'), true);

  // <=420 and landscape-phone rules should still preserve mobile phase text.
  assert.equal(css.includes('@media (max-width: 420px)'), true);
  assert.equal(css.includes('@media (orientation: landscape) and (max-height: 540px) and (max-width: 960px)'), true);
});

test('flow pacing contract keeps reveal/order/turn cues consistent', () => {
  const js = read('public/client.js');

  // Sequential board reveal gap: 0.5s between additional cards.
  assert.equal(js.includes('const COMMUNITY_REVEAL_GAP_MS = 500;'), true);
  assert.equal(js.includes('const delay = communityVisibleCards.length > 0 ? COMMUNITY_REVEAL_GAP_MS : 0;'), true);

  // Result effects must wait for reveal completion before chip push / big-win effect.
  assert.equal(js.includes('function shouldDelayResultEffects() {'), true);
  assert.equal(js.includes('if (shouldDelayResultEffects()) return;'), true);
  assert.equal(js.includes('flushPendingPotPushAnimation();'), true);
  assert.equal(js.includes('flushPendingCappuccinoCelebration();'), true);

  // Mobile turn cues: seat highlight + per-seat progress bar with urgent threshold.
  assert.equal(js.includes("node.className = `seat-node"), true);
  assert.equal(js.includes("timerBar.className = 'seat-turn-progress';"), true);
  assert.equal(js.includes('const urgent = deadline && remainMs <= 5000;'), true);

  // Seat hand type should be rendered in seat card area.
  assert.equal(js.includes("handTypeTag.className = 'seat-hand-type';"), true);
});
