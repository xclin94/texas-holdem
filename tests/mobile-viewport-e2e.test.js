const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const SERVER_START_TIMEOUT_MS = 10000;
const MOBILE_VIEWPORT = { width: 390, height: 844 };

let serverProcess = null;
let serverPort = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = addr && typeof addr === 'object' ? addr.port : 0;
      srv.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

function waitForServerReady(proc, timeoutMs = SERVER_START_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('server startup timeout'));
    }, timeoutMs);

    const onData = (buf) => {
      const text = String(buf || '');
      if (text.includes('Texas Hold\'em server running at')) {
        cleanup();
        resolve();
      }
    };

    const onExit = (code, signal) => {
      cleanup();
      reject(new Error(`server exited early: code=${code} signal=${signal || 'none'}`));
    };

    const cleanup = () => {
      clearTimeout(timer);
      proc.stdout?.off('data', onData);
      proc.stderr?.off('data', onData);
      proc.off('exit', onExit);
    };

    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);
    proc.on('exit', onExit);
  });
}

async function createRoomAsHost(page) {
  await page.goto(`http://127.0.0.1:${serverPort}`, { waitUntil: 'networkidle' });
  await page.fill('#nameInput', `Host-${Date.now().toString(36).slice(-4)}`);
  await page.click('#openCreatePanelBtn');
  await page.fill('#createRoomNameInput', `mobile-${Date.now().toString(36).slice(-4)}`);
  await page.fill('#createMaxPlayersInput', '2');
  await page.click('#createBtn');
  await page.waitForFunction(() => !document.getElementById('tableView')?.classList.contains('hidden'));
  return page.locator('#roomIdText').innerText();
}

async function joinRoomAsGuest(page, roomId) {
  await page.goto(`http://127.0.0.1:${serverPort}`, { waitUntil: 'networkidle' });
  await page.fill('#nameInput', `Guest-${Date.now().toString(36).slice(-4)}`);
  await page.click('#openJoinPanelBtn');
  await page.fill('#joinRoomInput', String(roomId || '').trim());
  await page.click('#joinBtn');
  await page.waitForFunction(() => !document.getElementById('tableView')?.classList.contains('hidden'));
}

async function pickAndDoAction(page) {
  const action = await page.evaluate(() => {
    const panel = document.getElementById('actionPanel');
    if (!panel || panel.classList.contains('hidden')) return '';
    const enabled = (id) => {
      const btn = document.getElementById(id);
      return Boolean(btn && !btn.disabled && !btn.classList.contains('hidden'));
    };
    if (enabled('allinBtn')) return 'allinBtn';
    if (enabled('callBtn')) return 'callBtn';
    if (enabled('checkBtn')) return 'checkBtn';
    if (enabled('foldBtn')) return 'foldBtn';
    return '';
  });
  if (!action) return false;
  await page.click(`#${action}`);
  return true;
}

async function actUntilFinished(hostPage, guestPage, timeoutMs = 25000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const finished = await hostPage.evaluate(() => (document.getElementById('phaseText')?.textContent || '').includes('结算'));
    if (finished) return true;

    const hostActed = await pickAndDoAction(hostPage);
    if (hostActed) {
      await sleep(90);
      continue;
    }

    const guestActed = await pickAndDoAction(guestPage);
    if (guestActed) {
      await sleep(90);
      continue;
    }

    await sleep(120);
  }
  return false;
}

test.before(async () => {
  serverPort = await findFreePort();
  serverProcess = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      HOLDEM_PORT: String(serverPort),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForServerReady(serverProcess);
});

test.after(async () => {
  if (!serverProcess || serverProcess.exitCode !== null) return;
  const exited = new Promise((resolve) => {
    serverProcess.once('exit', () => resolve());
  });
  serverProcess.kill('SIGTERM');
  await Promise.race([exited, sleep(2000)]);
  if (serverProcess.exitCode === null) {
    serverProcess.kill('SIGKILL');
    await Promise.race([exited, sleep(1000)]);
  }
});

test('mobile portrait layout keeps compact info and avoids seat/card overlap', async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
  });

  const context = await browser.newContext({ viewport: MOBILE_VIEWPORT });
  const page = await context.newPage();
  t.after(async () => {
    await context.close();
  });

  await createRoomAsHost(page);

  const metrics = await page.evaluate(() => {
    const status = document.querySelector('.status-row');
    const mobilePhase = document.getElementById('mobilePhaseText');
    const socialLauncher = document.getElementById('socialLauncherBtn');
    const settingsLauncher = document.getElementById('sideToggleBtn');
    const board = document.getElementById('communityCards');
    const table = document.getElementById('tableCanvas');
    const seats = Array.from(document.querySelectorAll('.seat-node'));

    const intersects = (a, b) =>
      a.left < b.right &&
      a.right > b.left &&
      a.top < b.bottom &&
      a.bottom > b.top;

    const boardRect = board ? board.getBoundingClientRect() : null;
    const overlapCount = boardRect
      ? seats
          .map((s) => s.getBoundingClientRect())
          .filter((r) => intersects(r, boardRect))
          .length
      : 0;

    const statusDisplay = status ? getComputedStyle(status).display : '';
    const phaseDisplay = mobilePhase ? getComputedStyle(mobilePhase).display : '';
    const phaseRect = mobilePhase?.getBoundingClientRect() || null;
    const socialRect = socialLauncher?.getBoundingClientRect() || null;
    const settingsRect = settingsLauncher?.getBoundingClientRect() || null;
    const tableRect = table?.getBoundingClientRect() || null;

    return {
      statusDisplay,
      phaseDisplay,
      phaseText: mobilePhase?.textContent || '',
      phaseRect,
      socialRect,
      settingsRect,
      tableRect,
      viewportH: window.innerHeight,
      overlapCount,
    };
  });

  assert.equal(metrics.statusDisplay, 'none');
  assert.notEqual(metrics.phaseDisplay, 'none');
  assert.equal(metrics.phaseText.length > 0, true);
  const phaseLeftInTable = metrics.phaseRect.left - metrics.tableRect.left;
  const phaseTopInTable = metrics.phaseRect.top - metrics.tableRect.top;
  const socialLeftInTable = metrics.socialRect.left - metrics.tableRect.left;
  const socialBottomInTable = metrics.tableRect.bottom - metrics.socialRect.bottom;
  assert.equal(phaseLeftInTable <= 24, true);
  assert.equal(phaseTopInTable <= 24, true);
  assert.equal(socialLeftInTable <= 24, true);
  assert.equal(socialBottomInTable <= 24, true);
  assert.equal(metrics.settingsRect.bottom < metrics.socialRect.top, true);
  assert.equal(metrics.overlapCount, 0);
});

test('mobile all-in flow reveals board sequentially before chip-settlement effect', async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
  });

  const hostContext = await browser.newContext({ viewport: MOBILE_VIEWPORT });
  const guestContext = await browser.newContext({ viewport: MOBILE_VIEWPORT });
  const hostPage = await hostContext.newPage();
  const guestPage = await guestContext.newPage();
  t.after(async () => {
    await hostContext.close();
    await guestContext.close();
  });

  const roomId = await createRoomAsHost(hostPage);
  await joinRoomAsGuest(guestPage, roomId);

  await hostPage.evaluate(() => {
    const probe = {
      startedAt: performance.now(),
      reveals: [],
      chipLayerAt: null,
      moneybagAt: null,
    };

    const board = document.getElementById('communityCards');
    const table = document.getElementById('tableCanvas');
    const capture = () => {
      const visibleCount = board ? board.querySelectorAll('.card-face:not(.back)').length : 0;
      const last = probe.reveals[probe.reveals.length - 1];
      if (!last || last.count !== visibleCount) {
        probe.reveals.push({ count: visibleCount, t: performance.now() });
      }
      if (probe.chipLayerAt === null && table?.querySelector('.chip-push-layer')) {
        probe.chipLayerAt = performance.now();
      }
      if (probe.moneybagAt === null && table?.querySelector('.moneybag-celebration')) {
        probe.moneybagAt = performance.now();
      }
    };

    const moBoard = new MutationObserver(capture);
    const moTable = new MutationObserver(capture);
    if (board) moBoard.observe(board, { childList: true, subtree: true });
    if (table) moTable.observe(table, { childList: true, subtree: true });
    capture();

    window.__mobileFlowProbe = probe;
    window.__mobileFlowProbeStop = () => {
      moBoard.disconnect();
      moTable.disconnect();
    };
  });

  await hostPage.click('#startBtn');
  await hostPage.waitForFunction(() => document.querySelectorAll('.seat-turn-progress').length >= 1, { timeout: 8000 });

  const finished = await actUntilFinished(hostPage, guestPage, 25000);
  assert.equal(finished, true);

  await hostPage.waitForFunction(() => document.querySelectorAll('#communityCards .card-face:not(.back)').length === 5, { timeout: 20000 });
  await hostPage.waitForTimeout(1600);

  const probe = await hostPage.evaluate(() => {
    if (typeof window.__mobileFlowProbeStop === 'function') window.__mobileFlowProbeStop();
    return window.__mobileFlowProbe;
  });

  const revealTimes = (probe?.reveals || []).filter((it) => Number(it.count) >= 1).sort((a, b) => a.count - b.count);
  const c3 = revealTimes.find((it) => it.count === 3);
  const c4 = revealTimes.find((it) => it.count === 4);
  const c5 = revealTimes.find((it) => it.count === 5);

  assert.equal(Boolean(c3 && c4 && c5), true);
  assert.equal(c4.t - c3.t >= 350, true);
  assert.equal(c5.t - c4.t >= 350, true);
  assert.equal(typeof probe.chipLayerAt === 'number', true);
  assert.equal(probe.chipLayerAt >= c5.t - 40, true);
});
