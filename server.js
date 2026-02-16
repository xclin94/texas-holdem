const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const PORT = Number(process.env.HOLDEM_PORT || 3000);
const AUTO_NEXT_HAND_DELAY_MS = 2200;

const DEFAULT_SETTINGS = Object.freeze({
  startingStack: 2000,
  smallBlind: 10,
  bigBlind: 20,
  maxPlayers: 9,
  turnTimeSec: 25,
  sessionMinutes: 180,
  allowStraddle: true,
  allowSpectators: true,
  tournamentMode: false,
  blindIntervalMinutes: 15,
});

const rooms = new Map();
let handCounter = 1;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'holdem.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function parseBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1' || value === 1) return true;
  if (value === 'false' || value === '0' || value === 0) return false;
  return fallback;
}

function sanitizeName(name) {
  if (typeof name !== 'string') return '';
  return name.trim().slice(0, 16);
}

function sanitizeRoomName(name) {
  if (typeof name !== 'string') return '';
  return name.trim().slice(0, 24);
}

function sanitizePassword(password) {
  if (typeof password !== 'string') return '';
  return password.trim().slice(0, 24);
}

function normalizeBanKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase();
}

function makeRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i += 1) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function generateUniqueRoomId() {
  let tries = 0;
  while (tries < 1000) {
    const id = makeRoomId();
    if (!rooms.has(id)) return id;
    tries += 1;
  }
  throw new Error('Cannot allocate room id');
}

function normalizeSettings(input, base = DEFAULT_SETTINGS) {
  const merged = input && typeof input === 'object' ? input : {};

  const startingStack = clampInt(merged.startingStack, 200, 500000, base.startingStack);
  const smallBlind = clampInt(merged.smallBlind, 1, 50000, base.smallBlind);
  const minBigBlind = Math.max(2, smallBlind * 2);
  const bigBlind = clampInt(merged.bigBlind, minBigBlind, 100000, Math.max(base.bigBlind, minBigBlind));

  return {
    startingStack,
    smallBlind,
    bigBlind,
    maxPlayers: clampInt(merged.maxPlayers, 2, 9, base.maxPlayers),
    turnTimeSec: clampInt(merged.turnTimeSec, 8, 90, base.turnTimeSec),
    sessionMinutes: clampInt(merged.sessionMinutes, 10, 720, base.sessionMinutes),
    allowStraddle: parseBoolean(merged.allowStraddle, base.allowStraddle),
    allowSpectators: parseBoolean(merged.allowSpectators, base.allowSpectators),
    tournamentMode: parseBoolean(merged.tournamentMode, base.tournamentMode),
    blindIntervalMinutes: clampInt(merged.blindIntervalMinutes, 1, 120, base.blindIntervalMinutes),
  };
}

function currentBlindState(room) {
  const baseSb = room.settings.smallBlind;
  const baseBb = room.settings.bigBlind;

  if (!room.settings.tournamentMode) {
    return {
      level: 1,
      smallBlind: baseSb,
      bigBlind: baseBb,
      nextLevelAt: null,
      startedAt: room.tournamentStartedAt || room.createdAt,
    };
  }

  const startedAt = room.tournamentStartedAt || room.createdAt;
  const intervalMs = room.settings.blindIntervalMinutes * 60 * 1000;
  const elapsed = Math.max(0, Date.now() - startedAt);
  const level = Math.floor(elapsed / intervalMs) + 1;
  const mult = Math.pow(2, Math.max(0, level - 1));
  const smallBlind = Math.max(1, Math.floor(baseSb * mult));
  const bigBlind = Math.max(smallBlind * 2, Math.floor(baseBb * mult));

  return {
    level,
    smallBlind,
    bigBlind,
    nextLevelAt: startedAt + level * intervalMs,
    startedAt,
  };
}

function roomIsExpired(room) {
  return Date.now() >= room.sessionEndsAt;
}

function secondsLeft(ts) {
  return Math.max(0, Math.ceil((ts - Date.now()) / 1000));
}

function logRoom(room, message) {
  room.logs.push(`${new Date().toLocaleTimeString()} ${message}`);
  if (room.logs.length > 160) {
    room.logs.splice(0, room.logs.length - 160);
  }
}

function ensureExpiryLog(room) {
  if (roomIsExpired(room) && !room.sessionExpiredNotified) {
    room.sessionExpiredNotified = true;
    logRoom(room, '房间时长已到，不能再开始新手牌');
  }
}

function appendGameEvent(room, type, message, extra = {}) {
  const game = room.game;
  if (!game) return;
  game.actionLog.push({
    ts: Date.now(),
    type,
    message,
    ...extra,
  });
  if (game.actionLog.length > 500) {
    game.actionLog.splice(0, game.actionLog.length - 500);
  }
}

function archiveFinishedHand(room) {
  const game = room.game;
  if (!game || !game.finished || game.archived) return;

  const replay = {
    handNo: game.handNo,
    startedAt: game.startedAt,
    endedAt: Date.now(),
    blinds: {
      level: game.blindLevel || 1,
      smallBlind: game.smallBlindAmount || room.settings.smallBlind,
      bigBlind: game.bigBlindAmount || room.settings.bigBlind,
    },
    players: game.order.map((id) => {
      const p = getPlayer(room, id);
      return {
        playerId: id,
        name: p?.name || id,
        seat: p?.seat || null,
        stackAfter: p?.stack ?? null,
      };
    }),
    board: [...game.community],
    result: game.result,
    actions: [...game.actionLog],
  };

  room.handHistory.push(replay);
  if (room.handHistory.length > 120) {
    room.handHistory.splice(0, room.handHistory.length - 120);
  }
  game.archived = true;
}

function getEffectiveBigBlind(room) {
  if (room.game && !room.game.finished && room.game.bigBlindAmount) {
    return room.game.bigBlindAmount;
  }
  return currentBlindState(room).bigBlind;
}

function getPlayer(room, playerId) {
  return room.players.find((p) => p.id === playerId);
}

function getSpectator(room, spectatorId) {
  return room.spectators.find((s) => s.id === spectatorId);
}

function getRole(room, memberId) {
  if (getPlayer(room, memberId)) return 'player';
  if (getSpectator(room, memberId)) return 'spectator';
  return null;
}

function nextSeat(room) {
  const used = new Set(room.players.map((p) => p.seat));
  for (let i = 1; i <= room.settings.maxPlayers; i += 1) {
    if (!used.has(i)) return i;
  }
  return null;
}

function resetHandFlags(player) {
  player.inHand = false;
  player.folded = false;
  player.allIn = false;
  player.betThisStreet = 0;
  player.totalContribution = 0;
  player.holeCards = [];
  player.lastAction = '';
}

function initPlayer(player, startingStack) {
  player.ready = true;
  player.stack = startingStack;
  resetHandFlags(player);
}

function reassignHost(room) {
  const hostAlive = getPlayer(room, room.hostId) || getSpectator(room, room.hostId);
  if (hostAlive) return;
  room.hostId = room.players[0]?.id || room.spectators[0]?.id || null;
}

function clearActionTimer(room) {
  if (room.turnTimer) {
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
  }
  if (room.game) {
    room.game.turnDeadlineAt = null;
  }
}

function clearAutoStartTimer(room) {
  if (!room) return;
  if (room.autoStartTimer) {
    clearTimeout(room.autoStartTimer);
    room.autoStartTimer = null;
  }
  room.autoStartAt = null;
}

function currentRoomOfSocket(socket) {
  const roomId = socket.data.roomId;
  if (!roomId) return null;
  return rooms.get(roomId) || null;
}

function roomCanStart(room) {
  if (!room) return false;
  if (room.game && !room.game.finished) return false;
  ensureExpiryLog(room);
  if (roomIsExpired(room)) return false;
  const readyPlayers = room.players.filter((p) => p.ready && p.stack > 0 && p.connected);
  return readyPlayers.length >= 2;
}

function scheduleAutoNextHand(room) {
  clearAutoStartTimer(room);
  if (!room || !room.game || !room.game.finished) return;
  if (!roomCanStart(room)) return;

  room.autoStartAt = Date.now() + AUTO_NEXT_HAND_DELAY_MS;
  room.autoStartTimer = setTimeout(() => {
    room.autoStartTimer = null;
    room.autoStartAt = null;
    if (!rooms.has(room.id)) return;
    if (!room.game || !room.game.finished) return;
    if (!roomCanStart(room)) return;

    if (!getPlayer(room, room.hostId)) {
      room.hostId = room.players[0]?.id || room.hostId;
    }
    const requestedBy = room.hostId;
    const r = startHand(room, requestedBy);
    if (!r.ok) return;
    logRoom(room, '自动开始下一手');
    broadcastRoom(room);
    broadcastLobby();
  }, AUTO_NEXT_HAND_DELAY_MS);
}

function createDeck() {
  const suits = ['S', 'H', 'D', 'C'];
  const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  const deck = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push(`${rank}${suit}`);
    }
  }
  return deck;
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
}

function rankValue(card) {
  const r = card[0];
  if (r >= '2' && r <= '9') return Number(r);
  if (r === 'T') return 10;
  if (r === 'J') return 11;
  if (r === 'Q') return 12;
  if (r === 'K') return 13;
  return 14;
}

function suitValue(card) {
  return card[1];
}

function compareEval(a, b) {
  if (a.category !== b.category) return a.category - b.category;
  const n = Math.max(a.tiebreak.length, b.tiebreak.length);
  for (let i = 0; i < n; i += 1) {
    const av = a.tiebreak[i] || 0;
    const bv = b.tiebreak[i] || 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function findStraightHigh(ranks) {
  const set = new Set(ranks);
  if (set.has(14)) set.add(1);
  for (let high = 14; high >= 5; high -= 1) {
    let ok = true;
    for (let i = 0; i < 5; i += 1) {
      if (!set.has(high - i)) {
        ok = false;
        break;
      }
    }
    if (ok) return high;
  }
  return 0;
}

function evaluate7(cards) {
  const ranks = cards.map(rankValue);
  const suits = cards.map(suitValue);
  const rankCounts = new Map();
  const suitMap = new Map();

  for (let i = 0; i < cards.length; i += 1) {
    const r = ranks[i];
    const s = suits[i];
    rankCounts.set(r, (rankCounts.get(r) || 0) + 1);
    if (!suitMap.has(s)) suitMap.set(s, []);
    suitMap.get(s).push(r);
  }

  const uniqueRanksDesc = [...new Set(ranks)].sort((a, b) => b - a);
  const groups = [...rankCounts.entries()]
    .map(([rank, count]) => ({ rank, count }))
    .sort((a, b) => b.count - a.count || b.rank - a.rank);

  let flushSuit = null;
  let flushRanksDesc = [];
  for (const [suit, suitRanks] of suitMap.entries()) {
    if (suitRanks.length >= 5) {
      const sorted = [...new Set(suitRanks)].sort((a, b) => b - a);
      if (!flushSuit || sorted[0] > flushRanksDesc[0]) {
        flushSuit = suit;
        flushRanksDesc = sorted;
      }
    }
  }

  if (flushSuit) {
    const sfHigh = findStraightHigh(flushRanksDesc);
    if (sfHigh > 0) {
      return { category: 8, name: sfHigh === 14 ? '皇家同花顺' : '同花顺', tiebreak: [sfHigh] };
    }
  }

  const four = groups.find((g) => g.count === 4);
  if (four) {
    const kicker = uniqueRanksDesc.find((r) => r !== four.rank);
    return { category: 7, name: '四条', tiebreak: [four.rank, kicker] };
  }

  const trips = groups.filter((g) => g.count === 3).map((g) => g.rank).sort((a, b) => b - a);
  const pairs = groups.filter((g) => g.count >= 2).map((g) => g.rank).sort((a, b) => b - a);
  if (trips.length >= 1) {
    let pairRank = pairs.find((r) => r !== trips[0]);
    if (!pairRank && trips.length >= 2) pairRank = trips[1];
    if (pairRank) {
      return { category: 6, name: '葫芦', tiebreak: [trips[0], pairRank] };
    }
  }

  if (flushSuit) {
    return { category: 5, name: '同花', tiebreak: flushRanksDesc.slice(0, 5) };
  }

  const straightHigh = findStraightHigh(uniqueRanksDesc);
  if (straightHigh > 0) {
    return { category: 4, name: '顺子', tiebreak: [straightHigh] };
  }

  if (trips.length >= 1) {
    const kickers = uniqueRanksDesc.filter((r) => r !== trips[0]).slice(0, 2);
    return { category: 3, name: '三条', tiebreak: [trips[0], ...kickers] };
  }

  if (pairs.length >= 2) {
    const topPair = pairs[0];
    const secondPair = pairs.find((r) => r !== topPair);
    const kicker = uniqueRanksDesc.find((r) => r !== topPair && r !== secondPair);
    return { category: 2, name: '两对', tiebreak: [topPair, secondPair, kicker] };
  }

  if (pairs.length >= 1) {
    const pair = pairs[0];
    const kickers = uniqueRanksDesc.filter((r) => r !== pair).slice(0, 3);
    return { category: 1, name: '一对', tiebreak: [pair, ...kickers] };
  }

  return { category: 0, name: '高牌', tiebreak: uniqueRanksDesc.slice(0, 5) };
}

function nextIndex(total, i) {
  return (i + 1) % total;
}

function nextEligibleFrom(order, fromIndex, predicate) {
  if (order.length === 0) return -1;
  let i = fromIndex;
  for (let steps = 0; steps < order.length; steps += 1) {
    i = nextIndex(order.length, i);
    const id = order[i];
    if (predicate(id)) return i;
  }
  return -1;
}

function activeNotFolded(room) {
  return room.players.filter((p) => p.inHand && !p.folded);
}

function playersAbleToAct(room) {
  return room.players.filter((p) => p.inHand && !p.folded && !p.allIn);
}

function computePotTotal(room) {
  return room.players.reduce((sum, p) => sum + (p.totalContribution || 0), 0);
}

function postChips(player, amount) {
  const pay = Math.max(0, Math.min(amount, player.stack));
  player.stack -= pay;
  player.betThisStreet += pay;
  player.totalContribution += pay;
  if (player.stack === 0) player.allIn = true;
  return pay;
}

function dealCard(game) {
  return game.deck.pop();
}

function eligibleToActInOrder(room, id) {
  const p = getPlayer(room, id);
  return Boolean(p && p.inHand && !p.folded && !p.allIn);
}

function setTurn(room, playerId) {
  const game = room.game;
  if (!game) return;

  clearActionTimer(room);
  game.turnId = playerId || null;

  if (!playerId || game.finished) {
    game.turnDeadlineAt = null;
    return;
  }

  const timeoutMs = room.settings.turnTimeSec * 1000;
  game.turnDeadlineAt = Date.now() + timeoutMs;
  const handNo = game.handNo;

  room.turnTimer = setTimeout(() => {
    handleTurnTimeout(room.id, handNo, playerId);
  }, timeoutMs + 25);
}

function assignPendingAndTurn(room, startIndex) {
  const game = room.game;
  const able = new Set(playersAbleToAct(room).map((p) => p.id));
  game.pending = [...able];
  if (game.pending.length === 0) {
    setTurn(room, null);
    return;
  }

  let idx = startIndex;
  let picked = null;
  for (let i = 0; i < game.order.length; i += 1) {
    const id = game.order[idx];
    if (able.has(id)) {
      picked = id;
      break;
    }
    idx = nextIndex(game.order.length, idx);
  }

  setTurn(room, picked);
}

function resetStreet(room) {
  const game = room.game;
  room.players.forEach((p) => {
    if (p.inHand) {
      p.betThisStreet = 0;
      p.lastAction = '';
    }
  });
  game.currentBet = 0;
  game.minRaise = getEffectiveBigBlind(room);
}

function removeFromPending(room, playerId) {
  const game = room.game;
  game.pending = game.pending.filter((id) => id !== playerId);
}

function resetPendingAfterAggression(room, aggressorId) {
  const game = room.game;
  game.pending = playersAbleToAct(room)
    .map((p) => p.id)
    .filter((id) => id !== aggressorId);
}

function advanceTurn(room, fromPlayerId) {
  const game = room.game;
  if (!game || game.finished) return;
  const pendingSet = new Set(game.pending);

  if (pendingSet.size === 0) {
    setTurn(room, null);
    return;
  }

  const start = Math.max(0, game.order.indexOf(fromPlayerId));
  const nextIdx = nextEligibleFrom(game.order, start, (id) => pendingSet.has(id));
  if (nextIdx < 0) {
    setTurn(room, null);
    return;
  }
  setTurn(room, game.order[nextIdx]);
}

function cleanupDisconnected(room) {
  const gameRunning = room.game && !room.game.finished;

  room.spectators = room.spectators.filter((s) => s.connected);

  if (!gameRunning) {
    room.players = room.players.filter((p) => p.connected);
  }

  reassignHost(room);

  if (room.players.length === 0 && room.spectators.length === 0) {
    clearActionTimer(room);
    clearAutoStartTimer(room);
    rooms.delete(room.id);
  }
}

function settleUncontested(room) {
  const game = room.game;
  if (!game || game.finished) return;

  const alive = activeNotFolded(room);
  if (alive.length !== 1) return;

  const winner = alive[0];
  const pot = computePotTotal(room);
  winner.stack += pot;

  game.result = {
    type: 'uncontested',
    winners: [{ playerId: winner.id, amount: pot, name: winner.name }],
    board: [...game.community],
    sidePots: [{ amount: pot, winners: [winner.id] }],
    revealed: {
      [winner.id]: [...winner.holeCards],
    },
  };

  logRoom(room, `${winner.name} 通过弃牌赢下底池 ${pot}`);
  appendGameEvent(room, 'result', `${winner.name} 非摊牌赢下 ${pot}`, {
    winners: [{ playerId: winner.id, amount: pot }],
  });
  game.finished = true;
  game.pending = [];
  setTurn(room, null);
  archiveFinishedHand(room);

  room.players.forEach((p) => {
    if (p.inHand) resetHandFlags(p);
  });

  cleanupDisconnected(room);
  scheduleAutoNextHand(room);
}

function computeSidePots(room) {
  const inHandPlayers = room.players.filter((p) => p.totalContribution > 0);
  const levels = [...new Set(inHandPlayers.map((p) => p.totalContribution))].sort((a, b) => a - b);

  const pots = [];
  let prev = 0;
  for (const level of levels) {
    const contributors = inHandPlayers.filter((p) => p.totalContribution >= level);
    const amount = (level - prev) * contributors.length;
    const eligible = contributors.filter((p) => p.inHand && !p.folded).map((p) => p.id);
    if (amount > 0 && eligible.length > 0) {
      pots.push({ amount, eligible });
    }
    prev = level;
  }
  return pots;
}

function distributeOddChips(room, winnerIds, odd, payouts) {
  if (odd <= 0 || winnerIds.length === 0) return;
  const game = room.game;
  const dealerIndex = game.order.indexOf(game.dealerId);

  if (dealerIndex < 0) {
    for (let i = 0; i < odd; i += 1) {
      const id = winnerIds[i % winnerIds.length];
      payouts.set(id, (payouts.get(id) || 0) + 1);
    }
    return;
  }

  const rankOrder = [];
  let idx = dealerIndex;
  for (let i = 0; i < game.order.length; i += 1) {
    idx = nextIndex(game.order.length, idx);
    rankOrder.push(game.order[idx]);
  }

  const winnersInOrder = rankOrder.filter((id) => winnerIds.includes(id));
  if (winnersInOrder.length === 0) return;

  for (let i = 0; i < odd; i += 1) {
    const id = winnersInOrder[i % winnersInOrder.length];
    payouts.set(id, (payouts.get(id) || 0) + 1);
  }
}

function settleShowdown(room) {
  const game = room.game;
  if (!game || game.finished) return;

  const contenders = room.players.filter((p) => p.inHand && !p.folded);
  if (contenders.length === 0) {
    game.finished = true;
    setTurn(room, null);
    archiveFinishedHand(room);
    scheduleAutoNextHand(room);
    return;
  }

  const evalMap = new Map();
  contenders.forEach((p) => {
    evalMap.set(p.id, evaluate7([...p.holeCards, ...game.community]));
  });

  const sidePots = computeSidePots(room);
  const payouts = new Map();
  const resultPots = [];

  sidePots.forEach((pot) => {
    let best = null;
    let winners = [];

    pot.eligible.forEach((id) => {
      const ev = evalMap.get(id);
      if (!best || compareEval(ev, best) > 0) {
        best = ev;
        winners = [id];
      } else if (compareEval(ev, best) === 0) {
        winners.push(id);
      }
    });

    const base = Math.floor(pot.amount / winners.length);
    const odd = pot.amount - base * winners.length;

    winners.forEach((id) => {
      payouts.set(id, (payouts.get(id) || 0) + base);
    });

    distributeOddChips(room, winners, odd, payouts);
    resultPots.push({ amount: pot.amount, winners: [...winners], handName: best ? best.name : '未知' });
  });

  payouts.forEach((amount, playerId) => {
    const p = getPlayer(room, playerId);
    if (p) p.stack += amount;
  });

  const revealed = {};
  contenders.forEach((p) => {
    revealed[p.id] = [...p.holeCards];
  });

  const winnerLines = [...payouts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, amount]) => {
      const p = getPlayer(room, id);
      return {
        playerId: id,
        name: p ? p.name : id,
        amount,
        hand: evalMap.get(id)?.name || '',
      };
    });

  game.result = {
    type: 'showdown',
    winners: winnerLines,
    board: [...game.community],
    sidePots: resultPots,
    revealed,
  };

  winnerLines.forEach((w) => {
    logRoom(room, `${w.name} 摊牌赢得 ${w.amount} (${w.hand})`);
  });
  appendGameEvent(room, 'result', '摊牌结算完成', {
    winners: winnerLines,
    sidePots: resultPots,
  });

  game.finished = true;
  game.pending = [];
  setTurn(room, null);
  archiveFinishedHand(room);

  room.players.forEach((p) => {
    if (p.inHand) resetHandFlags(p);
  });

  cleanupDisconnected(room);
  scheduleAutoNextHand(room);
}

function shouldSkipBetting(room) {
  const alive = activeNotFolded(room);
  if (alive.length <= 1) return true;
  const able = playersAbleToAct(room);
  return able.length <= 1;
}

function advanceStreet(room) {
  const game = room.game;
  if (!game || game.finished) return;

  if (activeNotFolded(room).length <= 1) {
    settleUncontested(room);
    return;
  }

  if (game.phase === 'river') {
    settleShowdown(room);
    return;
  }

  game.awaitingStraddle = false;
  game.straddlePlayerId = null;
  resetStreet(room);

  if (game.phase === 'preflop') {
    dealCard(game);
    game.community.push(dealCard(game), dealCard(game), dealCard(game));
    game.phase = 'flop';
    appendGameEvent(room, 'street', `翻牌: ${game.community.join(' ')}`, {
      street: 'flop',
      board: [...game.community],
    });
  } else if (game.phase === 'flop') {
    dealCard(game);
    game.community.push(dealCard(game));
    game.phase = 'turn';
    appendGameEvent(room, 'street', `转牌: ${game.community[3]}`, {
      street: 'turn',
      board: [...game.community],
    });
  } else if (game.phase === 'turn') {
    dealCard(game);
    game.community.push(dealCard(game));
    game.phase = 'river';
    appendGameEvent(room, 'street', `河牌: ${game.community[4]}`, {
      street: 'river',
      board: [...game.community],
    });
  }

  if (shouldSkipBetting(room)) {
    advanceStreet(room);
    return;
  }

  const dealerIndex = game.order.indexOf(game.dealerId);
  const firstActIndex = nextEligibleFrom(game.order, dealerIndex, (id) => eligibleToActInOrder(room, id));
  assignPendingAndTurn(room, firstActIndex);
}

function completeActionAndAdvance(room, playerId) {
  const game = room.game;

  if (activeNotFolded(room).length <= 1) {
    settleUncontested(room);
    return;
  }

  if (game.pending.length === 0) {
    advanceStreet(room);
    return;
  }

  advanceTurn(room, playerId);
}

function actionToCall(room, player) {
  const game = room.game;
  return Math.max(0, game.currentBet - player.betThisStreet);
}

function beginPreflopRound(room, anchorId) {
  const game = room.game;
  const anchorIndex = game.order.indexOf(anchorId);
  const firstActIndex = nextEligibleFrom(game.order, anchorIndex, (id) => eligibleToActInOrder(room, id));
  assignPendingAndTurn(room, firstActIndex);
  if (game.pending.length === 0) {
    advanceStreet(room);
  }
}

function applyStraddleDecision(room, player, action, rawAmount) {
  const game = room.game;
  if (!game.awaitingStraddle || game.straddlePlayerId !== player.id) {
    return { ok: false, error: '当前不是 straddle 决策阶段' };
  }

  if (action === 'skipstraddle') {
    player.lastAction = '放弃 straddle';
    appendGameEvent(room, 'straddle_skip', `${player.name} 放弃 straddle`, { playerId: player.id });
    game.awaitingStraddle = false;
    game.straddlePlayerId = null;
    beginPreflopRound(room, game.bigBlindId);
    return { ok: true };
  }

  if (action !== 'straddle') {
    return { ok: false, error: '请先决定是否 straddle' };
  }

  const maxTo = player.betThisStreet + player.stack;
  const minTo = game.currentBet * 2;
  const parsed = Number(rawAmount);
  const target = Number.isFinite(parsed) ? Math.floor(parsed) : minTo;

  if (target <= game.currentBet) return { ok: false, error: 'straddle 金额必须高于大盲' };
  if (target > maxTo) return { ok: false, error: '超过可用筹码' };
  if (target < minTo && target < maxTo) {
    return { ok: false, error: `straddle 至少到 ${minTo}` };
  }

  postChips(player, target - player.betThisStreet);
  const raiseSize = target - game.currentBet;
  game.currentBet = target;
  game.minRaise = Math.max(getEffectiveBigBlind(room), raiseSize);
  game.straddleAmount = target;
  game.awaitingStraddle = false;
  game.straddlePlayerId = null;
  player.lastAction = player.stack === 0 ? `全下 straddle 到 ${target}` : `straddle 到 ${target}`;
  appendGameEvent(room, 'straddle', `${player.name} straddle 到 ${target}`, {
    playerId: player.id,
    amount: target,
  });

  beginPreflopRound(room, player.id);
  return { ok: true };
}

function applyPlayerAction(room, playerId, action, rawAmount) {
  const game = room.game;
  if (!game || game.finished) {
    return { ok: false, error: '当前没有进行中的牌局' };
  }

  const player = getPlayer(room, playerId);
  if (!player) return { ok: false, error: '只有入座玩家可以行动' };
  if (game.turnId !== playerId) return { ok: false, error: '还没轮到你行动' };
  if (!player.inHand || player.folded || player.allIn) {
    return { ok: false, error: '当前无法行动' };
  }

  if (game.awaitingStraddle) {
    return applyStraddleDecision(room, player, action, rawAmount);
  }

  const toCall = actionToCall(room, player);
  const maxTo = player.betThisStreet + player.stack;
  const amount = Number(rawAmount);

  if (action === 'fold') {
    player.folded = true;
    player.lastAction = '弃牌';
    appendGameEvent(room, 'action', `${player.name} 弃牌`, { playerId: player.id, action: 'fold' });
    removeFromPending(room, playerId);
    completeActionAndAdvance(room, playerId);
    return { ok: true };
  }

  if (action === 'check') {
    if (toCall !== 0) return { ok: false, error: '当前不能过牌' };
    player.lastAction = '过牌';
    appendGameEvent(room, 'action', `${player.name} 过牌`, { playerId: player.id, action: 'check' });
    removeFromPending(room, playerId);
    completeActionAndAdvance(room, playerId);
    return { ok: true };
  }

  if (action === 'call') {
    if (toCall <= 0) return { ok: false, error: '当前不需要跟注' };
    const paid = postChips(player, toCall);
    player.lastAction = paid < toCall ? `跟注全下 ${paid}` : `跟注 ${paid}`;
    appendGameEvent(room, 'action', `${player.name} ${player.lastAction}`, {
      playerId: player.id,
      action: 'call',
      amount: paid,
    });
    removeFromPending(room, playerId);
    completeActionAndAdvance(room, playerId);
    return { ok: true };
  }

  if (action === 'allin') {
    if (player.stack <= 0) return { ok: false, error: '没有可用筹码' };

    const target = maxTo;
    const prevBet = game.currentBet;
    const before = player.betThisStreet;
    postChips(player, target - player.betThisStreet);
    const committed = player.betThisStreet - before;

    if (target > prevBet) {
      const raiseSize = target - prevBet;
      if (raiseSize >= game.minRaise) game.minRaise = raiseSize;
      game.currentBet = target;
      player.lastAction = `全下到 ${target}`;
      resetPendingAfterAggression(room, playerId);
    } else {
      player.lastAction = `全下 ${committed}`;
      removeFromPending(room, playerId);
    }
    appendGameEvent(room, 'action', `${player.name} ${player.lastAction}`, {
      playerId: player.id,
      action: 'allin',
      amount: committed,
      target,
    });

    completeActionAndAdvance(room, playerId);
    return { ok: true };
  }

  if (action === 'bet') {
    if (game.currentBet !== 0) return { ok: false, error: '当前应使用加注' };
    if (!Number.isFinite(amount)) return { ok: false, error: '下注金额无效' };

    const target = Math.floor(amount);
    if (target <= player.betThisStreet) return { ok: false, error: '下注过小' };
    if (target > maxTo) return { ok: false, error: '超过可用筹码' };
    const minBet = getEffectiveBigBlind(room);
    if (target < minBet && target < maxTo) {
      return { ok: false, error: `下注至少 ${minBet}` };
    }

    postChips(player, target - player.betThisStreet);
    game.currentBet = target;
    game.minRaise = target;
    player.lastAction = player.stack === 0 ? `全下下注 ${target}` : `下注 ${target}`;
    appendGameEvent(room, 'action', `${player.name} ${player.lastAction}`, {
      playerId: player.id,
      action: 'bet',
      target,
    });
    resetPendingAfterAggression(room, playerId);
    completeActionAndAdvance(room, playerId);
    return { ok: true };
  }

  if (action === 'raise') {
    if (game.currentBet === 0) return { ok: false, error: '当前应使用下注' };
    if (!Number.isFinite(amount)) return { ok: false, error: '加注金额无效' };

    const target = Math.floor(amount);
    const minTo = game.currentBet + game.minRaise;

    if (target <= game.currentBet) return { ok: false, error: '加注额必须高于当前注' };
    if (target > maxTo) return { ok: false, error: '超过可用筹码' };
    if (target < minTo && target < maxTo) return { ok: false, error: `最小加注到 ${minTo}` };

    const prevBet = game.currentBet;
    postChips(player, target - player.betThisStreet);
    const raiseSize = target - prevBet;
    if (raiseSize >= game.minRaise) game.minRaise = raiseSize;
    game.currentBet = target;

    player.lastAction = player.stack === 0 ? `全下到 ${target}` : `加注到 ${target}`;
    appendGameEvent(room, 'action', `${player.name} ${player.lastAction}`, {
      playerId: player.id,
      action: 'raise',
      target,
    });
    resetPendingAfterAggression(room, playerId);
    completeActionAndAdvance(room, playerId);
    return { ok: true };
  }

  return { ok: false, error: '未知动作' };
}

function handleTurnTimeout(roomId, handNo, turnId) {
  const room = rooms.get(roomId);
  if (!room || !room.game || room.game.finished) return;
  if (room.game.handNo !== handNo) return;
  if (room.game.turnId !== turnId) return;

  const player = getPlayer(room, turnId);
  if (!player) return;

  if (room.game.awaitingStraddle) {
    const r = applyPlayerAction(room, turnId, 'skipstraddle');
    if (r.ok) {
      logRoom(room, `${player.name} straddle 超时，自动跳过`);
      appendGameEvent(room, 'timeout', `${player.name} straddle 超时，自动跳过`, {
        playerId: player.id,
      });
      broadcastRoom(room);
      broadcastLobby();
    }
    return;
  }

  const need = actionToCall(room, player);
  const action = need === 0 ? 'check' : 'fold';
  const r = applyPlayerAction(room, turnId, action);
  if (r.ok) {
    logRoom(room, `${player.name} 行动超时，自动${action === 'check' ? '过牌' : '弃牌'}`);
    appendGameEvent(room, 'timeout', `${player.name} 行动超时，自动${action === 'check' ? '过牌' : '弃牌'}`, {
      playerId: player.id,
      action,
    });
    broadcastRoom(room);
    broadcastLobby();
  }
}

function startHand(room, requestedBy) {
  clearAutoStartTimer(room);
  if (room.hostId !== requestedBy) {
    return { ok: false, error: '只有房主可以开始牌局' };
  }

  if (!getPlayer(room, requestedBy)) {
    return { ok: false, error: '房主当前是观战者，请先入座再开局' };
  }

  if (room.game && !room.game.finished) {
    return { ok: false, error: '牌局正在进行中' };
  }

  ensureExpiryLog(room);
  if (roomIsExpired(room)) {
    return { ok: false, error: '房间时长已到，不能再开新手牌' };
  }

  const participants = room.players
    .filter((p) => p.ready && p.stack > 0 && p.connected)
    .sort((a, b) => a.seat - b.seat);

  if (participants.length < 2) {
    return { ok: false, error: '至少 2 名已准备玩家才能开始' };
  }

  room.players.forEach((p) => resetHandFlags(p));

  const order = participants.map((p) => p.id);

  let dealerId = room.lastDealerId;
  if (!dealerId || !order.includes(dealerId)) {
    dealerId = order[order.length - 1];
  }

  const dealerIndex = order.indexOf(dealerId);
  const nextDealerIdx = nextIndex(order.length, dealerIndex);
  dealerId = order[nextDealerIdx];
  room.lastDealerId = dealerId;

  let sbIdx;
  let bbIdx;

  if (order.length === 2) {
    sbIdx = order.indexOf(dealerId);
    bbIdx = nextEligibleFrom(order, sbIdx, () => true);
  } else {
    sbIdx = nextEligibleFrom(order, order.indexOf(dealerId), () => true);
    bbIdx = nextEligibleFrom(order, sbIdx, () => true);
  }

  const smallBlindId = order[sbIdx];
  const bigBlindId = order[bbIdx];

  const deck = createDeck();
  shuffle(deck);
  if (room.settings.tournamentMode && !room.tournamentStartedAt) {
    room.tournamentStartedAt = Date.now();
  }
  const blindState = currentBlindState(room);

  room.game = {
    handNo: handCounter,
    startedAt: Date.now(),
    finished: false,
    phase: 'preflop',
    deck,
    community: [],
    order,
    pending: [],
    turnId: null,
    turnDeadlineAt: null,
    dealerId,
    smallBlindId,
    bigBlindId,
    blindLevel: blindState.level,
    smallBlindAmount: blindState.smallBlind,
    bigBlindAmount: blindState.bigBlind,
    nextBlindAt: blindState.nextLevelAt,
    currentBet: 0,
    minRaise: blindState.bigBlind,
    result: null,
    actionLog: [],
    awaitingStraddle: false,
    straddlePlayerId: null,
    straddleAmount: 0,
    archived: false,
  };
  handCounter += 1;

  participants.forEach((p) => {
    p.inHand = true;
    p.folded = false;
    p.allIn = false;
    p.betThisStreet = 0;
    p.totalContribution = 0;
    p.lastAction = '';
    p.holeCards = [dealCard(room.game), dealCard(room.game)];
  });

  const sbPlayer = getPlayer(room, smallBlindId);
  const bbPlayer = getPlayer(room, bigBlindId);
  const sbPaid = postChips(sbPlayer, room.game.smallBlindAmount);
  const bbPaid = postChips(bbPlayer, room.game.bigBlindAmount);

  room.game.currentBet = bbPaid;
  room.game.minRaise = room.game.bigBlindAmount;

  sbPlayer.lastAction = `小盲 ${sbPaid}`;
  bbPlayer.lastAction = `大盲 ${bbPaid}`;

  logRoom(room, `第 ${room.game.handNo} 手牌开始，庄家 ${getPlayer(room, dealerId)?.name || ''}`);
  appendGameEvent(room, 'hand_start', `第 ${room.game.handNo} 手牌开始`, {
    dealerId,
    smallBlindId,
    bigBlindId,
    smallBlind: room.game.smallBlindAmount,
    bigBlind: room.game.bigBlindAmount,
    blindLevel: room.game.blindLevel,
  });
  appendGameEvent(room, 'blind', `${sbPlayer.name} 下小盲 ${sbPaid}`, { playerId: sbPlayer.id, amount: sbPaid });
  appendGameEvent(room, 'blind', `${bbPlayer.name} 下大盲 ${bbPaid}`, { playerId: bbPlayer.id, amount: bbPaid });

  if (room.settings.allowStraddle && order.length >= 3) {
    const straddleIdx = nextEligibleFrom(order, bbIdx, (id) => eligibleToActInOrder(room, id));
    if (straddleIdx >= 0) {
      const straddleId = order[straddleIdx];
      const straddlePlayer = getPlayer(room, straddleId);
      if (straddlePlayer && straddlePlayer.stack > 0) {
        room.game.awaitingStraddle = true;
        room.game.straddlePlayerId = straddleId;
        room.game.pending = [straddleId];
        setTurn(room, straddleId);
        logRoom(room, `${straddlePlayer.name} 可选择 straddle`);
        appendGameEvent(room, 'straddle_prompt', `${straddlePlayer.name} 可选择 straddle`, {
          playerId: straddlePlayer.id,
        });
        return { ok: true };
      }
    }
  }

  beginPreflopRound(room, bigBlindId);
  return { ok: true };
}

function roomSummary(room) {
  const inGame = Boolean(room.game && !room.game.finished);
  const blind = inGame
    ? {
        level: room.game.blindLevel || 1,
        smallBlind: room.game.smallBlindAmount || room.settings.smallBlind,
        bigBlind: room.game.bigBlindAmount || room.settings.bigBlind,
      }
    : currentBlindState(room);
  return {
    roomId: room.id,
    roomName: room.name,
    hasPassword: Boolean(room.password),
    playerCount: room.players.length,
    readyCount: room.players.filter((p) => p.ready).length,
    spectatorCount: room.spectators.length,
    maxPlayers: room.settings.maxPlayers,
    inGame,
    smallBlind: blind.smallBlind,
    bigBlind: blind.bigBlind,
    blindLevel: blind.level,
    tournamentMode: room.settings.tournamentMode,
    blindIntervalMinutes: room.settings.blindIntervalMinutes,
    allowStraddle: room.settings.allowStraddle,
    expiresAt: room.sessionEndsAt,
    expired: roomIsExpired(room),
  };
}

function broadcastLobby() {
  const data = [...rooms.values()]
    .map((room) => roomSummary(room))
    .sort((a, b) => {
      if (a.inGame !== b.inGame) return a.inGame ? 1 : -1;
      return a.roomId.localeCompare(b.roomId);
    });

  io.emit('lobbyRooms', {
    rooms: data,
    serverNow: Date.now(),
  });
}

function buildActionState(room, viewer) {
  const game = room.game;
  if (!game || game.finished || !viewer) return null;
  if (game.turnId !== viewer.id || !viewer.inHand || viewer.folded || viewer.allIn) return null;

  if (game.awaitingStraddle) {
    const maxTo = viewer.betThisStreet + viewer.stack;
    const minTo = game.currentBet * 2;
    return {
      mode: 'straddle',
      canSkipStraddle: true,
      canStraddle: maxTo > game.currentBet,
      minStraddleTo: minTo,
      defaultStraddleTo: Math.min(maxTo, minTo),
      maxTo,
    };
  }

  const toCall = actionToCall(room, viewer);
  const maxTo = viewer.betThisStreet + viewer.stack;
  const minRaiseTo = game.currentBet + game.minRaise;

  return {
    mode: 'normal',
    toCall,
    canCheck: toCall === 0,
    canCall: toCall > 0 && viewer.stack > 0,
    canBet: game.currentBet === 0 && viewer.stack > 0,
    canRaise: game.currentBet > 0 && maxTo > game.currentBet && viewer.stack > toCall,
    minBetTo: getEffectiveBigBlind(room),
    minRaiseTo,
    maxTo,
  };
}

function serializeRoom(room, viewerId) {
  ensureExpiryLog(room);

  const viewer = getPlayer(room, viewerId);
  const viewerRole = getRole(room, viewerId);
  const game = room.game;
  const blindState = game && !game.finished
    ? {
        level: game.blindLevel || 1,
        smallBlind: game.smallBlindAmount || room.settings.smallBlind,
        bigBlind: game.bigBlindAmount || room.settings.bigBlind,
        nextLevelAt: game.nextBlindAt || null,
      }
    : currentBlindState(room);
  const resultRevealed = game?.result?.revealed || {};

  const players = [...room.players]
    .sort((a, b) => a.seat - b.seat)
    .map((p) => {
      const showCards = viewerId === p.id || Boolean(resultRevealed[p.id]);
      return {
        id: p.id,
        name: p.name,
        seat: p.seat,
        stack: p.stack,
        ready: p.ready,
        inHand: p.inHand,
        folded: p.folded,
        allIn: p.allIn,
        connected: p.connected,
        betThisStreet: p.betThisStreet,
        totalContribution: p.totalContribution,
        lastAction: p.lastAction,
        holeCards: showCards ? [...p.holeCards] : [],
      };
    });

  const spectators = room.spectators.map((s) => ({
    id: s.id,
    name: s.name,
    connected: s.connected,
  }));

  const canTakeSeat = viewerRole === 'spectator' && room.players.length < room.settings.maxPlayers;
  const canBecomeSpectator =
    viewerRole === 'player' &&
    room.settings.allowSpectators &&
    (!game || game.finished || !viewer?.inHand);

  return {
    roomId: room.id,
    roomName: room.name,
    hostId: room.hostId,
    meId: viewerId,
    myRole: viewerRole,
    hasPassword: Boolean(room.password),
    settings: {
      ...room.settings,
      mode: 'NLH',
    },
    blindState,
    sessionEndsAt: room.sessionEndsAt,
    sessionExpired: roomIsExpired(room),
    sessionRemainSec: secondsLeft(room.sessionEndsAt),
    autoStartAt: room.autoStartAt || null,
    autoStartDelayMs: AUTO_NEXT_HAND_DELAY_MS,
    players,
    spectators,
    logs: room.logs.slice(-80),
    game: game
      ? {
          handNo: game.handNo,
          phase: game.finished ? 'finished' : game.phase,
          community: [...game.community],
          dealerId: game.dealerId,
          smallBlindId: game.smallBlindId,
          bigBlindId: game.bigBlindId,
          blindLevel: game.blindLevel || 1,
          smallBlindAmount: game.smallBlindAmount || room.settings.smallBlind,
          bigBlindAmount: game.bigBlindAmount || room.settings.bigBlind,
          nextBlindAt: game.nextBlindAt || null,
          turnId: game.turnId,
          turnDeadlineAt: game.turnDeadlineAt,
          currentBet: game.currentBet,
          minRaise: game.minRaise,
          potTotal: computePotTotal(room),
          finished: game.finished,
          result: game.result,
          pending: [...game.pending],
          awaitingStraddle: game.awaitingStraddle,
          straddlePlayerId: game.straddlePlayerId,
          straddleAmount: game.straddleAmount,
        }
      : null,
    canStart: roomCanStart(room),
    canTakeSeat,
    canBecomeSpectator,
    bannedNames: room.hostId === viewerId ? [...room.bannedNames] : [],
    handHistory: room.handHistory
      .slice(-20)
      .map((h) => ({
        handNo: h.handNo,
        startedAt: h.startedAt,
        endedAt: h.endedAt,
        blinds: h.blinds,
        winners: h.result?.winners || [],
        stacksAfter: (h.players || []).map((p) => ({
          playerId: p.playerId,
          name: p.name,
          stackAfter: p.stackAfter,
        })),
      }))
      .reverse(),
    actionState: buildActionState(room, viewer),
    serverNow: Date.now(),
  };
}

function broadcastRoom(room) {
  if (!room) return;

  const memberIds = [
    ...room.players.map((p) => p.id),
    ...room.spectators.map((s) => s.id),
  ];

  memberIds.forEach((id) => {
    const socket = io.sockets.sockets.get(id);
    if (socket) {
      socket.emit('roomState', serializeRoom(room, id));
    }
  });
}

function sendError(socket, msg) {
  socket.emit('errorMessage', msg);
}

function removePlayerFromRoom(room, playerId) {
  room.players = room.players.filter((p) => p.id !== playerId);
}

function removeSpectatorFromRoom(room, spectatorId) {
  room.spectators = room.spectators.filter((s) => s.id !== spectatorId);
}

function forceRemoveMember(room, targetId, opts = {}) {
  const player = getPlayer(room, targetId);
  const spectator = getSpectator(room, targetId);
  if (!player && !spectator) {
    return { ok: false, error: '目标成员不存在' };
  }

  const ban = Boolean(opts.ban);
  const targetName = player?.name || spectator?.name || '';
  if (ban && targetName) {
    room.bannedNames.add(normalizeBanKey(targetName));
  }

  const targetSocket = io.sockets.sockets.get(targetId);
  if (targetSocket) {
    targetSocket.leave(room.id);
    targetSocket.data.roomId = null;
    targetSocket.data.role = null;
    targetSocket.emit('kicked', {
      roomId: room.id,
      reason: opts.reason || (ban ? '你已被房主封禁' : '你已被房主移出房间'),
      banned: ban,
    });
  }

  if (spectator) {
    removeSpectatorFromRoom(room, targetId);
    logRoom(room, `${spectator.name} 被房主${ban ? '封禁并移出' : '移出房间'}`);
    cleanupDisconnected(room);
    return { ok: true };
  }

  if (room.game && !room.game.finished && player.inHand && !player.folded) {
    player.connected = false;
    player.folded = true;
    player.lastAction = ban ? '被封禁自动弃牌' : '被移出自动弃牌';
    removeFromPending(room, player.id);
    appendGameEvent(room, 'admin', `${player.name} 被房主${ban ? '封禁' : '移出'}并自动弃牌`, {
      playerId: player.id,
      action: ban ? 'ban' : 'kick',
    });
    completeActionAndAdvance(room, player.id);
  } else {
    removePlayerFromRoom(room, targetId);
  }

  logRoom(room, `${player.name} 被房主${ban ? '封禁并移出' : '移出房间'}`);
  cleanupDisconnected(room);
  return { ok: true };
}

function leaveRoom(socket, silent = false) {
  const room = currentRoomOfSocket(socket);
  if (!room) return;

  const role = socket.data.role;
  const player = getPlayer(room, socket.id);
  const spectator = getSpectator(room, socket.id);

  socket.leave(room.id);
  socket.data.roomId = null;
  socket.data.role = null;

  if (role === 'spectator' || spectator) {
    if (spectator) {
      removeSpectatorFromRoom(room, spectator.id);
      logRoom(room, `${spectator.name} 离开了观战`);
    }
    cleanupDisconnected(room);
    if (!silent && rooms.has(room.id)) {
      broadcastRoom(room);
    }
    broadcastLobby();
    return;
  }

  if (!player) {
    cleanupDisconnected(room);
    broadcastLobby();
    return;
  }

  if (room.game && !room.game.finished && player.inHand && !player.folded) {
    player.connected = false;
    player.folded = true;
    player.lastAction = '离开自动弃牌';
    removeFromPending(room, player.id);
    completeActionAndAdvance(room, player.id);
    logRoom(room, `${player.name} 离开房间，自动弃牌`);
  } else {
    removePlayerFromRoom(room, player.id);
    logRoom(room, `${player.name} 离开了房间`);
  }

  cleanupDisconnected(room);
  if (!silent && rooms.has(room.id)) {
    broadcastRoom(room);
  }
  broadcastLobby();
}

function joinAsPlayer(socket, room, name) {
  if (getPlayer(room, socket.id) || getSpectator(room, socket.id)) {
    return { ok: false, error: '请稍后再加入该房间' };
  }
  const seat = nextSeat(room);
  if (!seat) return { ok: false, error: '房间已满' };

  const player = {
    id: socket.id,
    name,
    connected: true,
    seat,
  };
  initPlayer(player, room.settings.startingStack);

  room.players.push(player);
  socket.join(room.id);
  socket.data.roomId = room.id;
  socket.data.role = 'player';

  return { ok: true, role: 'player' };
}

function joinAsSpectator(socket, room, name) {
  if (getPlayer(room, socket.id) || getSpectator(room, socket.id)) {
    return { ok: false, error: '请稍后再加入该房间' };
  }
  if (!room.settings.allowSpectators) {
    return { ok: false, error: '该房间未开启观战' };
  }

  const spectator = {
    id: socket.id,
    name,
    connected: true,
  };
  room.spectators.push(spectator);

  socket.join(room.id);
  socket.data.roomId = room.id;
  socket.data.role = 'spectator';

  return { ok: true, role: 'spectator' };
}

io.on('connection', (socket) => {
  socket.data.roomId = null;
  socket.data.role = null;

  socket.emit('lobbyRooms', {
    rooms: [...rooms.values()].map((room) => roomSummary(room)),
    serverNow: Date.now(),
  });

  socket.on('listRooms', () => {
    socket.emit('lobbyRooms', {
      rooms: [...rooms.values()].map((room) => roomSummary(room)),
      serverNow: Date.now(),
    });
  });

  socket.on('createRoom', (payload = {}) => {
    const name = sanitizeName(payload.name);
    if (!name) {
      sendError(socket, '请输入昵称');
      return;
    }

    const roomName = sanitizeRoomName(payload.roomName || payload.settings?.roomName || '');
    const password = sanitizePassword(payload.password || payload.settings?.password || '');
    const settings = normalizeSettings(payload.settings || payload, DEFAULT_SETTINGS);

    leaveRoom(socket, true);

    const roomId = generateUniqueRoomId();
    const hostPlayer = {
      id: socket.id,
      name,
      connected: true,
      seat: 1,
    };
    initPlayer(hostPlayer, settings.startingStack);

    const room = {
      id: roomId,
      name: roomName || `牌桌-${roomId}`,
      password,
      hostId: hostPlayer.id,
      players: [hostPlayer],
      spectators: [],
      logs: [],
      game: null,
      lastDealerId: null,
      settings,
      createdAt: Date.now(),
      tournamentStartedAt: null,
      sessionEndsAt: Date.now() + settings.sessionMinutes * 60 * 1000,
      sessionExpiredNotified: false,
      turnTimer: null,
      autoStartTimer: null,
      autoStartAt: null,
      handHistory: [],
      bannedNames: new Set(),
    };

    rooms.set(roomId, room);
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.role = 'player';

    logRoom(room, `${name} 创建了房间 ${room.name}`);
    socket.emit('joinedRoom', { roomId, playerId: socket.id, role: 'player' });
    broadcastRoom(room);
    broadcastLobby();
  });

  socket.on('joinRoom', (payload = {}) => {
    const roomId = String(payload.roomId || '').toUpperCase().trim();
    const name = sanitizeName(payload.name);
    const password = sanitizePassword(payload.password || '');
    const spectatorMode = parseBoolean(payload.spectator, false);

    if (!name) {
      sendError(socket, '请输入昵称');
      return;
    }

    const room = rooms.get(roomId);
    if (!room) {
      sendError(socket, '房间不存在');
      return;
    }

    if (room.bannedNames.has(normalizeBanKey(name))) {
      sendError(socket, '你已被该房间封禁');
      return;
    }

    if (room.password && room.password !== password) {
      sendError(socket, '房间密码错误');
      return;
    }

    leaveRoom(socket, true);

    let joined;
    if (spectatorMode) {
      joined = joinAsSpectator(socket, room, name);
    } else {
      joined = joinAsPlayer(socket, room, name);
    }

    if (!joined.ok) {
      sendError(socket, joined.error);
      return;
    }

    logRoom(room, `${name} ${joined.role === 'spectator' ? '加入了观战' : '加入了房间'}`);
    socket.emit('joinedRoom', { roomId, playerId: socket.id, role: joined.role });
    broadcastRoom(room);
    broadcastLobby();
  });

  socket.on('takeSeat', () => {
    const room = currentRoomOfSocket(socket);
    if (!room) return;

    const spectator = getSpectator(room, socket.id);
    if (!spectator) {
      sendError(socket, '你当前不是观战者');
      return;
    }

    const seat = nextSeat(room);
    if (!seat) {
      sendError(socket, '当前没有空位');
      return;
    }

    removeSpectatorFromRoom(room, socket.id);

    const player = {
      id: socket.id,
      name: spectator.name,
      connected: true,
      seat,
    };
    initPlayer(player, room.settings.startingStack);
    room.players.push(player);

    socket.data.role = 'player';
    logRoom(room, `${player.name} 入座到 ${seat} 号位`);
    reassignHost(room);
    broadcastRoom(room);
    broadcastLobby();
  });

  socket.on('becomeSpectator', () => {
    const room = currentRoomOfSocket(socket);
    if (!room) return;

    if (!room.settings.allowSpectators) {
      sendError(socket, '该房间未开启观战');
      return;
    }

    const player = getPlayer(room, socket.id);
    if (!player) {
      sendError(socket, '你当前不是入座玩家');
      return;
    }

    if (room.game && !room.game.finished && player.inHand && !player.folded) {
      sendError(socket, '当前在手牌中，不能切换为观战');
      return;
    }

    removePlayerFromRoom(room, socket.id);
    room.spectators.push({ id: socket.id, name: player.name, connected: true });
    socket.data.role = 'spectator';
    reassignHost(room);

    logRoom(room, `${player.name} 切换为观战`);
    broadcastRoom(room);
    broadcastLobby();
  });

  socket.on('changeSeat', (payload = {}) => {
    const room = currentRoomOfSocket(socket);
    if (!room) return;

    const requester = getPlayer(room, socket.id);
    if (!requester) {
      sendError(socket, '观战者不能换座');
      return;
    }

    const targetId = String(payload.targetId || socket.id);
    const target = getPlayer(room, targetId);
    if (!target) {
      sendError(socket, '目标玩家不存在');
      return;
    }

    if (targetId !== socket.id && room.hostId !== socket.id) {
      sendError(socket, '只有房主可以为其他玩家换座');
      return;
    }

    const targetInHand = Boolean(room.game && !room.game.finished && target.inHand && !target.folded);
    if (targetInHand) {
      sendError(socket, '当前在手牌中，不能换座');
      return;
    }

    const seat = clampInt(payload.seat, 1, room.settings.maxPlayers, 0);
    if (!seat) {
      sendError(socket, '座位号无效');
      return;
    }

    if (target.seat === seat) {
      sendError(socket, '已在该座位');
      return;
    }

    const occupant = room.players.find((p) => p.seat === seat);
    if (!occupant) {
      const oldSeat = target.seat;
      target.seat = seat;
      logRoom(room, `${target.name} 从 ${oldSeat} 号位换到 ${seat} 号位`);
      broadcastRoom(room);
      broadcastLobby();
      return;
    }

    if (occupant.id === target.id) {
      sendError(socket, '已在该座位');
      return;
    }

    const canSwap =
      room.hostId === socket.id &&
      (!(room.game && !room.game.finished && occupant.inHand && !occupant.folded));
    if (!canSwap) {
      sendError(socket, '目标座位已有人，无法换座');
      return;
    }

    const oldSeat = target.seat;
    target.seat = seat;
    occupant.seat = oldSeat;
    logRoom(room, `${target.name} 与 ${occupant.name} 交换了座位 (${oldSeat}<->${seat})`);
    broadcastRoom(room);
    broadcastLobby();
  });

  socket.on('toggleReady', () => {
    const room = currentRoomOfSocket(socket);
    if (!room) return;

    const player = getPlayer(room, socket.id);
    if (!player) {
      sendError(socket, '观战者无法准备');
      return;
    }

    if (room.game && !room.game.finished) {
      sendError(socket, '牌局进行中，无法切换准备状态');
      return;
    }

    if (player.stack <= 0) {
      player.stack = room.settings.startingStack;
      logRoom(room, `${player.name} 重新买入 ${room.settings.startingStack}`);
    }

    player.ready = !player.ready;
    logRoom(room, `${player.name} ${player.ready ? '已准备' : '取消准备'}`);
    broadcastRoom(room);
    broadcastLobby();
  });

  socket.on('updateRoomConfig', (payload = {}) => {
    const room = currentRoomOfSocket(socket);
    if (!room) return;

    sendError(socket, '房间配置在创建后锁定，不支持修改');
    return;

    if (room.hostId !== socket.id) {
      sendError(socket, '只有房主可以修改配置');
      return;
    }

    if (room.game && !room.game.finished) {
      sendError(socket, '牌局进行中，不能修改配置');
      return;
    }

    const nextSettings = normalizeSettings(payload.settings || payload, room.settings);
    if (room.players.length > nextSettings.maxPlayers) {
      sendError(socket, `当前入座人数超过目标上限 ${nextSettings.maxPlayers}`);
      return;
    }

    const nextName = sanitizeRoomName(payload.roomName || room.name) || room.name;
    const nextPassword = sanitizePassword(payload.password !== undefined ? payload.password : room.password);

    room.settings = nextSettings;
    room.name = nextName;
    room.password = nextPassword;
    room.tournamentStartedAt = nextSettings.tournamentMode ? Date.now() : null;
    room.sessionEndsAt = Date.now() + nextSettings.sessionMinutes * 60 * 1000;
    room.sessionExpiredNotified = false;

    logRoom(room, '房主更新了房间玩法与时长配置');
    broadcastRoom(room);
    broadcastLobby();
  });

  socket.on('kickMember', (payload = {}) => {
    const room = currentRoomOfSocket(socket);
    if (!room) return;

    if (room.hostId !== socket.id) {
      sendError(socket, '只有房主可以执行该操作');
      return;
    }

    const targetId = String(payload.targetId || '');
    if (!targetId || targetId === socket.id) {
      sendError(socket, '不能操作自己');
      return;
    }

    const r = forceRemoveMember(room, targetId, { ban: false });
    if (!r.ok) {
      sendError(socket, r.error);
      return;
    }

    reassignHost(room);
    if (rooms.has(room.id)) {
      broadcastRoom(room);
    }
    broadcastLobby();
  });

  socket.on('banMember', (payload = {}) => {
    const room = currentRoomOfSocket(socket);
    if (!room) return;

    if (room.hostId !== socket.id) {
      sendError(socket, '只有房主可以执行该操作');
      return;
    }

    const targetId = String(payload.targetId || '');
    if (!targetId || targetId === socket.id) {
      sendError(socket, '不能操作自己');
      return;
    }

    const r = forceRemoveMember(room, targetId, { ban: true });
    if (!r.ok) {
      sendError(socket, r.error);
      return;
    }

    reassignHost(room);
    if (rooms.has(room.id)) {
      broadcastRoom(room);
    }
    broadcastLobby();
  });

  socket.on('unbanName', (payload = {}) => {
    const room = currentRoomOfSocket(socket);
    if (!room) return;

    if (room.hostId !== socket.id) {
      sendError(socket, '只有房主可以执行该操作');
      return;
    }

    const key = normalizeBanKey(payload.name);
    if (!key) {
      sendError(socket, '无效昵称');
      return;
    }

    room.bannedNames.delete(key);
    logRoom(room, `房主解封了 ${payload.name}`);
    broadcastRoom(room);
    broadcastLobby();
  });

  socket.on('getHandHistory', () => {
    const room = currentRoomOfSocket(socket);
    if (!room) return;

    socket.emit('handHistoryData', {
      items: room.handHistory
        .slice(-60)
        .map((h) => ({
          handNo: h.handNo,
          startedAt: h.startedAt,
          endedAt: h.endedAt,
          blinds: h.blinds,
          winners: h.result?.winners || [],
          stacksAfter: (h.players || []).map((p) => ({
            playerId: p.playerId,
            name: p.name,
            stackAfter: p.stackAfter,
          })),
        }))
        .reverse(),
    });
  });

  socket.on('getHandReplay', (payload = {}) => {
    const room = currentRoomOfSocket(socket);
    if (!room) return;

    const handNo = Number(payload.handNo);
    if (!Number.isFinite(handNo)) {
      sendError(socket, '手牌编号无效');
      return;
    }

    const replay = room.handHistory.find((h) => h.handNo === handNo);
    if (!replay) {
      sendError(socket, '未找到该手牌回放');
      return;
    }

    socket.emit('handReplayData', replay);
  });

  socket.on('startHand', () => {
    const room = currentRoomOfSocket(socket);
    if (!room) return;

    const r = startHand(room, socket.id);
    if (!r.ok) {
      sendError(socket, r.error);
      return;
    }

    broadcastRoom(room);
    broadcastLobby();
  });

  socket.on('playerAction', (payload = {}) => {
    const room = currentRoomOfSocket(socket);
    if (!room) return;

    const action = String(payload.action || '').toLowerCase();
    const amount = payload.amount;

    const r = applyPlayerAction(room, socket.id, action, amount);
    if (!r.ok) {
      sendError(socket, r.error);
      return;
    }

    broadcastRoom(room);
    broadcastLobby();
  });

  socket.on('chatMessage', (payload = {}) => {
    const room = currentRoomOfSocket(socket);
    if (!room) return;

    const role = getRole(room, socket.id);
    const player = getPlayer(room, socket.id);
    const spectator = getSpectator(room, socket.id);
    const name = player?.name || spectator?.name || '匿名';

    if (!role) return;

    const message = String(payload.message || '').trim().slice(0, 120);
    if (!message) return;

    logRoom(room, `${name}${role === 'spectator' ? '(观战)' : ''}: ${message}`);
    broadcastRoom(room);
  });

  socket.on('leaveRoom', () => {
    leaveRoom(socket);
  });

  socket.on('disconnect', () => {
    const room = currentRoomOfSocket(socket);
    if (!room) return;

    const player = getPlayer(room, socket.id);
    const spectator = getSpectator(room, socket.id);

    socket.data.roomId = null;
    socket.data.role = null;

    if (spectator) {
      spectator.connected = false;
      removeSpectatorFromRoom(room, spectator.id);
      logRoom(room, `${spectator.name} 已离线（观战）`);
      cleanupDisconnected(room);
      if (rooms.has(room.id)) {
        broadcastRoom(room);
      }
      broadcastLobby();
      return;
    }

    if (!player) {
      cleanupDisconnected(room);
      broadcastLobby();
      return;
    }

    player.connected = false;

    if (room.game && !room.game.finished && player.inHand && !player.folded) {
      player.folded = true;
      player.lastAction = '掉线自动弃牌';
      removeFromPending(room, player.id);
      completeActionAndAdvance(room, player.id);
      logRoom(room, `${player.name} 掉线，自动弃牌`);
      if (rooms.has(room.id)) {
        broadcastRoom(room);
      }
      broadcastLobby();
      return;
    }

    removePlayerFromRoom(room, player.id);
    logRoom(room, `${player.name} 已离线`);

    cleanupDisconnected(room);
    if (rooms.has(room.id)) {
      broadcastRoom(room);
    }
    broadcastLobby();
  });
});

server.listen(PORT, () => {
  console.log(`Texas Hold'em server running at http://localhost:${PORT}`);
});
