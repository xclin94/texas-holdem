const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');
const { io } = require('socket.io-client');

const ROOT = path.resolve(__dirname, '..');
const SERVER_START_TIMEOUT_MS = 10000;
const EVENT_TIMEOUT_MS = 12000;
const HAND_EVENT_TIMEOUT_MS = 20000;

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

function waitForEvent(socket, eventName, predicate = () => true, timeoutMs = EVENT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timeout waiting for "${eventName}"`));
    }, timeoutMs);

    const handler = (payload) => {
      let matched = false;
      try {
        matched = predicate(payload);
      } catch (err) {
        cleanup();
        reject(err);
        return;
      }
      if (!matched) return;
      cleanup();
      resolve(payload);
    };

    const onConnectError = (err) => {
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    const cleanup = () => {
      clearTimeout(timer);
      socket.off(eventName, handler);
      socket.off('connect_error', onConnectError);
    };

    socket.on(eventName, handler);
    socket.on('connect_error', onConnectError);
  });
}

async function connectClient() {
  const socket = io(`http://127.0.0.1:${serverPort}`, {
    transports: ['websocket'],
    timeout: 5000,
    reconnection: false,
    forceNew: true,
  });
  await waitForEvent(socket, 'connect', () => true, EVENT_TIMEOUT_MS);
  return socket;
}

function closeSocket(socket) {
  if (!socket) return;
  try {
    socket.removeAllListeners();
    socket.disconnect();
  } catch {
    // ignore teardown failures
  }
}

async function createRoomAs(socket, name, settings = {}) {
  const joined = waitForEvent(socket, 'joinedRoom', (payload) => Boolean(payload?.roomId));
  const roomStateReady = waitForEvent(
    socket,
    'roomState',
    (state) => Boolean(state?.roomId) && (state.players || []).some((p) => p.id === socket.id),
    EVENT_TIMEOUT_MS,
  );
  socket.emit('createRoom', {
    name,
    roomName: `matrix-${Date.now().toString(36)}`,
    ...settings,
  });
  const [joinedPayload, state] = await Promise.all([joined, roomStateReady]);
  return joinedPayload.roomId || state.roomId;
}

async function joinRoomAs(socket, roomId, name) {
  const joined = waitForEvent(socket, 'joinedRoom', (payload) => payload?.roomId === roomId);
  const roomStateReady = waitForEvent(
    socket,
    'roomState',
    (state) => state?.roomId === roomId && (state.players || []).some((p) => p.id === socket.id),
    EVENT_TIMEOUT_MS,
  );
  socket.emit('joinRoom', { roomId, name, spectator: false });
  await Promise.all([joined, roomStateReady]);
}

async function setupPlayers(t, count, roomSettings = {}) {
  const sockets = [];
  for (let i = 0; i < count; i += 1) {
    sockets.push(await connectClient());
  }
  t.after(() => sockets.forEach(closeSocket));

  const host = sockets[0];
  const roomId = await createRoomAs(host, `Host-${Date.now().toString(36).slice(-4)}`, {
    maxPlayers: Math.max(2, count),
    ...roomSettings,
  });
  for (let i = 1; i < sockets.length; i += 1) {
    await joinRoomAs(sockets[i], roomId, `P${i}-${Date.now().toString(36).slice(-4)}`);
  }
  return { roomId, sockets };
}

function socketById(sockets) {
  const map = new Map();
  sockets.forEach((s) => map.set(s.id, s));
  return map;
}

function playerById(state, id) {
  return (state?.players || []).find((p) => p.id === id) || null;
}

function toCallFor(state, id) {
  const g = state?.game;
  const p = playerById(state, id);
  if (!g || !p) return 0;
  return Math.max(0, Number(g.currentBet || 0) - Number(p.betThisStreet || 0));
}

function activeNotFoldedCount(state) {
  return (state?.players || []).filter((p) => p.inHand && !p.folded).length;
}

function chooseAction(state, scenario, ctx) {
  const turnId = state?.game?.turnId;
  const player = playerById(state, turnId);
  const toCall = toCallFor(state, turnId);
  if (!turnId || !player) return 'fold';

  if (scenario === 'uncontested') {
    if (turnId === state.game.bigBlindId && activeNotFoldedCount(state) > 1 && toCall === 0) {
      return 'check';
    }
    return 'fold';
  }

  if (scenario === 'showdown_allin') {
    if (!ctx.opened) {
      ctx.opened = true;
      return 'allin';
    }
    if (!ctx.called && toCall > 0) {
      ctx.called = true;
      return 'call';
    }
    if (toCall > 0) {
      return 'fold';
    }
    return 'check';
  }

  // scenario: checkdown
  return toCall > 0 ? 'call' : 'check';
}

async function playHandScenario(host, byId, startState, scenario, expectedType) {
  let state = startState;
  const handNo = state.game.handNo;
  const ctx = { opened: false, called: false };
  let steps = 0;

  while (true) {
    assert.equal(state.game.handNo, handNo);

    if (state.game.finished) {
      assert.equal(state.game.result?.type, expectedType);
      return state;
    }

    const turnId = state.game.turnId;
    assert.ok(turnId, `hand ${handNo} should always have turnId before finish`);
    const actor = byId.get(turnId);
    assert.ok(actor, `missing socket for turn player ${turnId}`);

    const action = chooseAction(state, scenario, ctx);
    actor.emit('playerAction', { action });

    state = await waitForEvent(
      host,
      'roomState',
      (next) => next?.game?.handNo === handNo,
      HAND_EVENT_TIMEOUT_MS,
    );

    steps += 1;
    assert.equal(steps < 260, true, `hand ${handNo} too many steps in scenario ${scenario}`);
  }
}

async function waitForHandStart(host, previousHandNo = 0) {
  return waitForEvent(
    host,
    'roomState',
    (state) =>
      state?.game &&
      !state.game.finished &&
      state.game.handNo > previousHandNo &&
      Boolean(state.game.turnId),
    EVENT_TIMEOUT_MS + 12000,
  );
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

test('multi-hand matrix covers counts and diverse hand scenarios', async (t) => {
  const matrix = [
    { count: 2, scenarios: [['checkdown', 'showdown'], ['uncontested', 'uncontested']] },
    { count: 4, scenarios: [['uncontested', 'uncontested'], ['showdown_allin', 'showdown'], ['checkdown', 'showdown']] },
    { count: 6, scenarios: [['uncontested', 'uncontested'], ['showdown_allin', 'showdown']] },
    { count: 9, scenarios: [['uncontested', 'uncontested'], ['showdown_allin', 'showdown']] },
  ];

  for (const entry of matrix) {
    const { sockets } = await setupPlayers(t, entry.count, { allowStraddle: false, startingStack: 4000 });
    const host = sockets[0];
    const byId = socketById(sockets);

    host.emit('startHand');
    let state = await waitForHandStart(host, 0);

    for (let i = 0; i < entry.scenarios.length; i += 1) {
      const [scenario, expectedType] = entry.scenarios[i];
      const finished = await playHandScenario(host, byId, state, scenario, expectedType);
      const handNo = finished.game.handNo;
      assert.equal(finished.game.finished, true);
      if (i < entry.scenarios.length - 1) {
        state = await waitForHandStart(host, handNo);
      }
    }

    // leave all sockets in this matrix row
    for (const s of sockets) {
      s.emit('leaveRoom');
      closeSocket(s);
    }
    await sleep(120);
  }
});
