const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');
const { io } = require('socket.io-client');

const ROOT = path.resolve(__dirname, '..');
const SERVER_START_TIMEOUT_MS = 8000;
const EVENT_TIMEOUT_MS = 6000;

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
    // ignore close failures in teardown
  }
}

async function createRoomAs(socket, name) {
  const joined = waitForEvent(socket, 'joinedRoom', (payload) => Boolean(payload?.roomId));
  const roomStateReady = waitForEvent(
    socket,
    'roomState',
    (state) => Boolean(state?.roomId) && (state.players || []).some((p) => p.id === socket.id),
    EVENT_TIMEOUT_MS,
  );
  socket.emit('createRoom', {
    name,
    roomName: `phase-${Date.now().toString(36)}`,
  });
  const [joinedPayload, state] = await Promise.all([joined, roomStateReady]);
  const roomId = joinedPayload.roomId || state?.roomId;
  return roomId;
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

async function setupTwoPlayers(t) {
  const host = await connectClient();
  const guest = await connectClient();
  t.after(() => {
    closeSocket(host);
    closeSocket(guest);
  });

  const roomId = await createRoomAs(host, `Host-${Date.now().toString(36).slice(-4)}`);
  await joinRoomAs(guest, roomId, `Guest-${Date.now().toString(36).slice(-4)}`);
  return { host, guest, roomId };
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

test('phase1: quick emote should broadcast to all players', async (t) => {
  const { host, guest } = await setupTwoPlayers(t);

  const hostGot = waitForEvent(host, 'emoteEvent', (e) => e?.kind === 'quick' && e?.code === 'like');
  const guestGot = waitForEvent(guest, 'emoteEvent', (e) => e?.kind === 'quick' && e?.code === 'like');
  host.emit('sendEmote', { kind: 'quick', code: 'like' });

  const [onHost, onGuest] = await Promise.all([hostGot, guestGot]);
  assert.equal(onHost.fromId, host.id);
  assert.equal(onGuest.fromId, host.id);
  assert.equal(onHost.targetId, null);
  assert.equal(onGuest.targetId, null);
});

test('phase2: prop emote should support target/combo/counter', async (t) => {
  const { host, guest } = await setupTwoPlayers(t);

  const firstHost = waitForEvent(host, 'emoteEvent', (e) => e?.kind === 'prop' && e?.code === 'egg' && e?.combo === 1);
  const firstGuest = waitForEvent(guest, 'emoteEvent', (e) => e?.kind === 'prop' && e?.code === 'egg' && e?.combo === 1);
  host.emit('sendEmote', { kind: 'prop', code: 'egg', targetId: guest.id });
  const [evt1Host, evt1Guest] = await Promise.all([firstHost, firstGuest]);
  assert.equal(evt1Host.targetId, guest.id);
  assert.equal(evt1Guest.targetId, guest.id);
  assert.equal(evt1Host.counter, false);

  await sleep(420);
  const comboHost = waitForEvent(host, 'emoteEvent', (e) => e?.kind === 'prop' && e?.code === 'egg' && e?.combo === 2);
  const comboGuest = waitForEvent(guest, 'emoteEvent', (e) => e?.kind === 'prop' && e?.code === 'egg' && e?.combo === 2);
  host.emit('sendEmote', { kind: 'prop', code: 'egg', targetId: guest.id });
  const [evt2Host, evt2Guest] = await Promise.all([comboHost, comboGuest]);
  assert.equal(evt2Host.combo, 2);
  assert.equal(evt2Guest.combo, 2);

  await sleep(420);
  const counterHost = waitForEvent(host, 'emoteEvent', (e) => e?.kind === 'prop' && e?.counter === true && e?.fromId === guest.id);
  const counterGuest = waitForEvent(guest, 'emoteEvent', (e) => e?.kind === 'prop' && e?.counter === true && e?.fromId === guest.id);
  guest.emit('sendEmote', { kind: 'prop', code: 'egg', targetId: host.id, counter: true });
  const [counterOnHost, counterOnGuest] = await Promise.all([counterHost, counterGuest]);
  assert.equal(counterOnHost.targetId, host.id);
  assert.equal(counterOnGuest.targetId, host.id);
  assert.equal(counterOnHost.counter, true);
});

test('phase3: chat channel and emote validation should work', async (t) => {
  const { host, guest } = await setupTwoPlayers(t);

  const selfTargetError = waitForEvent(host, 'errorMessage', (msg) => String(msg).includes('请选择其他玩家作为目标'));
  host.emit('sendEmote', { kind: 'prop', code: 'flower', targetId: host.id });
  await selfTargetError;

  await sleep(420);
  const firstQuick = waitForEvent(host, 'emoteEvent', (e) => e?.kind === 'quick' && e?.code === 'laugh');
  const fastError = waitForEvent(host, 'errorMessage', (msg) => String(msg).includes('发送太快'));
  host.emit('sendEmote', { kind: 'quick', code: 'laugh' });
  host.emit('sendEmote', { kind: 'quick', code: 'wow' });
  await firstQuick;
  await fastError;

  const chatMessage = `phase-chat-${Date.now().toString(36)}`;
  const guestState = waitForEvent(
    guest,
    'roomState',
    (state) => state?.logs?.some((line) => line.includes(chatMessage)),
    EVENT_TIMEOUT_MS,
  );
  host.emit('chatMessage', { message: chatMessage });
  const state = await guestState;
  assert.equal(state.logs.some((line) => line.includes(chatMessage)), true);
});
