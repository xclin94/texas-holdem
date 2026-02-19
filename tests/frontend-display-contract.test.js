const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('table html keeps required display anchors for mobile/center info', () => {
  const html = read('public/holdem.html');
  assert.equal(html.includes('id="mobilePhaseText"'), true);
  assert.equal(html.includes('id="streetBetHeroText"'), true);
  assert.equal(html.includes('id="startBtn"'), true);
  assert.equal(html.includes('id="communityCards"'), true);
  assert.equal(html.includes('id="seatMap"'), true);
});

test('client display logic keeps expected status/button/reconnect rules', () => {
  const js = read('public/client.js');

  // settlement phase wording and center start visibility contract
  assert.equal(js.includes("finished: '结算中'"), true);
  assert.equal(js.includes('const showCenterStart = Boolean(!roomState?.hasStartedOnce && isHost && (!g || g.finished));'), true);

  // folded player should no longer render hand cards during active hand
  assert.equal(js.includes('!p.folded && !roomState.game?.finished'), true);

  // reconnect recovery contract
  assert.equal(js.includes('const clientReconnectKey = ensureReconnectKey();'), true);
  assert.equal(js.includes('reconnectingToRoom = true;'), true);
  assert.equal(js.includes('reconnectKey: clientReconnectKey'), true);

  // fold throw visual effect is wired from action tracking
  assert.equal(js.includes('spawnFoldDiscardEffect'), true);

  // chat and social overlay contracts
  assert.equal(js.includes('who.textContent = `${item.sender}:`;'), true);
  assert.equal(js.includes('msg.textContent = event.message || \'\';'), true);

  // stack text must stay full numeric format instead of k/m shorthand
  assert.equal(js.includes('return String(Math.max(0, Math.floor(n)));'), true);

  // big-win effect should use moneybag instead of old maid/cappuccino scene
  assert.equal(js.includes("node.className = 'moneybag-celebration';"), true);
});

test('styles keep board readability and visible card-back/fold effects', () => {
  const css = read('public/styles.css');

  assert.equal(css.includes('.table-oval {'), true);
  assert.equal(css.includes('z-index: 3;'), true);
  assert.equal(css.includes('pointer-events: none;'), true);

  assert.equal(css.includes('.card-face.back {'), true);
  assert.equal(css.includes('repeating-linear-gradient('), true);

  assert.equal(css.includes('.fold-throw-card {'), true);
  assert.equal(css.includes('@keyframes foldThrow'), true);

  // moneybag visual keyframes/styles should exist for big-win effect
  assert.equal(css.includes('.moneybag-main {'), true);
  assert.equal(css.includes('@keyframes moneybagZoom'), true);
});
