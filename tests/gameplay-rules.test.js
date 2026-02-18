const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');
const { io } = require('socket.io-client');

const ROOT = path.resolve(__dirname, '..');
const SERVER_START_TIMEOUT_MS = 8000;
const EVENT_TIMEOUT_MS = 7000;

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

async function createRoomAs(socket, name, overrides = {}, opts = {}) {
  const joined = waitForEvent(socket, 'joinedRoom', (payload) => Boolean(payload?.roomId));
  const roomStateReady = waitForEvent(
    socket,
    'roomState',
    (state) => Boolean(state?.roomId) && (state.players || []).some((p) => p.id === socket.id),
    EVENT_TIMEOUT_MS,
  );
  const reconnectKey = String(opts.reconnectKey || '');
  socket.emit('createRoom', {
    name,
    roomName: `rules-${Date.now().toString(36)}`,
    ...overrides,
    reconnectKey,
  });
  const [joinedPayload, state] = await Promise.all([joined, roomStateReady]);
  return joinedPayload.roomId || state.roomId;
}

async function joinRoomAs(socket, roomId, name, opts = {}) {
  const joined = waitForEvent(socket, 'joinedRoom', (payload) => payload?.roomId === roomId);
  const roomStateReady = waitForEvent(
    socket,
    'roomState',
    (state) => state?.roomId === roomId && (state.players || []).some((p) => p.id === socket.id),
    EVENT_TIMEOUT_MS,
  );
  socket.emit('joinRoom', {
    roomId,
    name,
    spectator: Boolean(opts.spectator),
    password: String(opts.password || ''),
    reconnectKey: String(opts.reconnectKey || ''),
  });
  await Promise.all([joined, roomStateReady]);
}

async function setupPlayers(t, count, roomOverrides = {}) {
  const sockets = [];
  for (let i = 0; i < count; i += 1) {
    sockets.push(await connectClient());
  }
  t.after(() => sockets.forEach(closeSocket));

  const host = sockets[0];
  const roomId = await createRoomAs(host, `Host-${Date.now().toString(36).slice(-4)}`, roomOverrides);
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

test('postflop action starts from small blind', async (t) => {
  const { sockets } = await setupPlayers(t, 3, { allowStraddle: false });
  const [host, p1, p2] = sockets;
  const byId = socketById(sockets);

  const started = waitForEvent(
    host,
    'roomState',
    (state) => state?.game && !state.game.finished && state.game.phase === 'preflop' && Boolean(state.game.turnId),
  );
  host.emit('startHand');
  let state = await started;

  const handNo = state.game.handNo;
  const dealerId = state.game.dealerId;
  const smallBlindId = state.game.smallBlindId;
  const bigBlindId = state.game.bigBlindId;
  assert.equal(state.game.turnId, dealerId);

  byId.get(dealerId).emit('playerAction', { action: 'call' });
  state = await waitForEvent(
    host,
    'roomState',
    (next) => next?.game?.handNo === handNo && next.game.turnId === smallBlindId && next.game.phase === 'preflop',
  );

  byId.get(smallBlindId).emit('playerAction', { action: 'call' });
  state = await waitForEvent(
    host,
    'roomState',
    (next) => next?.game?.handNo === handNo && next.game.turnId === bigBlindId && next.game.phase === 'preflop',
  );

  byId.get(bigBlindId).emit('playerAction', { action: 'check' });
  state = await waitForEvent(
    host,
    'roomState',
    (next) => next?.game?.handNo === handNo && next.game.phase === 'flop' && Boolean(next.game.turnId),
  );

  assert.equal(state.game.turnId, smallBlindId);
  closeSocket(p1);
  closeSocket(p2);
});

test('all-in showdown reveals cards in serialized players', async (t) => {
  const { sockets } = await setupPlayers(t, 2, { allowStraddle: false, startingStack: 400 });
  const [host, guest] = sockets;
  const byId = socketById(sockets);

  const started = waitForEvent(
    host,
    'roomState',
    (state) => state?.game && !state.game.finished && state.game.phase === 'preflop' && Boolean(state.game.turnId),
  );
  host.emit('startHand');
  let state = await started;
  const handNo = state.game.handNo;

  const firstActorId = state.game.turnId;
  byId.get(firstActorId).emit('playerAction', { action: 'allin' });
  state = await waitForEvent(
    host,
    'roomState',
    (next) => next?.game?.handNo === handNo && !next.game.finished && Boolean(next.game.turnId) && next.game.turnId !== firstActorId,
  );

  byId.get(state.game.turnId).emit('playerAction', { action: 'call' });
  state = await waitForEvent(
    host,
    'roomState',
    (next) => next?.game?.handNo === handNo && next.game.finished && next.game.result?.type === 'showdown',
    EVENT_TIMEOUT_MS + 3000,
  );

  const revealed = state.game.result?.revealed || {};
  assert.equal(Array.isArray(revealed[host.id]) && revealed[host.id].length === 2, true);
  assert.equal(Array.isArray(revealed[guest.id]) && revealed[guest.id].length === 2, true);

  const hostPlayer = (state.players || []).find((p) => p.id === host.id);
  const guestPlayer = (state.players || []).find((p) => p.id === guest.id);
  assert.equal(Array.isArray(hostPlayer?.holeCards) && hostPlayer.holeCards.length === 2, true);
  assert.equal(Array.isArray(guestPlayer?.holeCards) && guestPlayer.holeCards.length === 2, true);
});

test('auto next hand countdown uses 3 seconds and starts automatically', async (t) => {
  const { sockets } = await setupPlayers(t, 3, { allowStraddle: false });
  const [host] = sockets;
  const byId = socketById(sockets);

  const started = waitForEvent(
    host,
    'roomState',
    (state) => state?.game && !state.game.finished && state.game.phase === 'preflop' && Boolean(state.game.turnId),
  );
  host.emit('startHand');
  let state = await started;
  const handNo = state.game.handNo;
  const dealerId = state.game.dealerId;
  const smallBlindId = state.game.smallBlindId;

  byId.get(dealerId).emit('playerAction', { action: 'fold' });
  state = await waitForEvent(
    host,
    'roomState',
    (next) => next?.game?.handNo === handNo && !next.game.finished && next.game.turnId === smallBlindId,
  );
  byId.get(smallBlindId).emit('playerAction', { action: 'fold' });

  state = await waitForEvent(
    host,
    'roomState',
    (next) => next?.game?.handNo === handNo && next.game.finished && Boolean(next.autoStartAt),
  );

  assert.equal(state.hasStartedOnce, true);
  assert.equal(state.autoStartDelayMs, 3000);
  const deltaMs = Number(state.autoStartAt) - Number(state.serverNow);
  assert.equal(deltaMs > 2200 && deltaMs <= 3400, true);

  const nextHand = await waitForEvent(
    host,
    'roomState',
    (next) => next?.game && !next.game.finished && next.game.handNo === handNo + 1,
    EVENT_TIMEOUT_MS + 5000,
  );
  assert.equal(nextHand.game.handNo, handNo + 1);
});

test('turn timeout action is delayed for visual pacing', async (t) => {
  const { sockets } = await setupPlayers(t, 2, { allowStraddle: false, turnTimeSec: 8 });
  const [host] = sockets;

  const started = waitForEvent(
    host,
    'roomState',
    (state) => state?.game && !state.game.finished && state.game.phase === 'preflop' && Boolean(state.game.turnId),
  );
  host.emit('startHand');
  const firstState = await started;
  const firstTurnId = firstState.game.turnId;
  const firstServerTs = Number(firstState.serverNow);

  const advanced = await waitForEvent(
    host,
    'roomState',
    (state) =>
      state?.game &&
      !state.game.finished &&
      state.game.phase === 'preflop' &&
      Boolean(state.game.turnId) &&
      state.game.turnId !== firstTurnId,
    EVENT_TIMEOUT_MS + 6000,
  );
  const elapsed = Number(advanced.serverNow) - firstServerTs;
  assert.equal(elapsed >= 8400, true);
  assert.equal(elapsed <= 12000, true);
});

test('finished table keeps auto countdown with one player and restarts immediately when another sits', async (t) => {
  const { roomId, sockets } = await setupPlayers(t, 2, { allowStraddle: false });
  const [host, guest] = sockets;
  const byId = socketById(sockets);

  const started = waitForEvent(
    host,
    'roomState',
    (state) => state?.game && !state.game.finished && state.game.phase === 'preflop' && Boolean(state.game.turnId),
  );
  host.emit('startHand');
  let state = await started;
  const handNo = state.game.handNo;

  byId.get(state.game.turnId).emit('playerAction', { action: 'fold' });
  state = await waitForEvent(
    host,
    'roomState',
    (next) => next?.game?.handNo === handNo && next.game.finished && Boolean(next.autoStartAt),
  );
  const firstAutoStartAt = Number(state.autoStartAt);
  assert.equal(state.players.length, 2);

  guest.emit('leaveRoom');
  state = await waitForEvent(
    host,
    'roomState',
    (next) => next?.game?.handNo === handNo && next.game.finished && next.players?.length === 1 && Boolean(next.autoStartAt),
    EVENT_TIMEOUT_MS + 2000,
  );

  const rolled = await waitForEvent(
    host,
    'roomState',
    (next) =>
      next?.game?.handNo === handNo &&
      next.game.finished &&
      next.players?.length === 1 &&
      Boolean(next.autoStartAt) &&
      Number(next.autoStartAt) > firstAutoStartAt,
    EVENT_TIMEOUT_MS + 7000,
  );
  assert.equal(Boolean(rolled.autoStartAt), true);

  const newcomer = await connectClient();
  t.after(() => closeSocket(newcomer));
  const nextHandPromise = waitForEvent(
    host,
    'roomState',
    (next) => next?.game && !next.game.finished && next.game.handNo === handNo + 1,
    EVENT_TIMEOUT_MS + 3000,
  );
  await joinRoomAs(newcomer, roomId, `Late-${Date.now().toString(36).slice(-4)}`);
  const nextHand = await nextHandPromise;
  assert.equal(nextHand.game.handNo, handNo + 1);
});

test('disconnected player keeps seat and can recover by reconnect key', async (t) => {
  const host = await connectClient();
  const guest = await connectClient();
  t.after(() => {
    closeSocket(host);
    closeSocket(guest);
  });

  const hostName = `Host-${Date.now().toString(36).slice(-4)}`;
  const guestName = `Guest-${Date.now().toString(36).slice(-4)}`;
  const hostKey = `rk-${Date.now().toString(36)}-host`;
  const guestKey = `rk-${Date.now().toString(36)}-guest`;

  const roomId = await createRoomAs(host, hostName, { allowStraddle: false }, { reconnectKey: hostKey });
  await joinRoomAs(guest, roomId, guestName, { reconnectKey: guestKey });

  const guestOldId = guest.id;

  closeSocket(guest);
  const disconnectedState = await waitForEvent(
    host,
    'roomState',
    (next) => {
      if (next?.roomId !== roomId) return false;
      const target = (next.players || []).find((p) => p.id === guestOldId);
      return Boolean(target && target.connected === false);
    },
    EVENT_TIMEOUT_MS + 3000,
  );
  const stillSeated = (disconnectedState.players || []).find((p) => p.id === guestOldId);
  const guestSeat = stillSeated?.seat;
  assert.equal(stillSeated?.connected, false);
  assert.equal(Number.isFinite(guestSeat), true);

  const recovered = await connectClient();
  t.after(() => closeSocket(recovered));
  const recoveredStatePromise = waitForEvent(
    host,
    'roomState',
    (next) => {
      if (next?.roomId !== roomId) return false;
      const target = (next.players || []).find((p) => p.seat === guestSeat);
      return Boolean(target && target.connected === true && target.id !== guestOldId);
    },
    EVENT_TIMEOUT_MS + 4000,
  );
  await joinRoomAs(recovered, roomId, guestName, { reconnectKey: guestKey });
  const recoveredState = await recoveredStatePromise;
  const guestAfter = (recoveredState.players || []).find((p) => p.seat === guestSeat);
  assert.equal(guestAfter?.connected, true);
  assert.equal(guestAfter?.name, guestName);
});
