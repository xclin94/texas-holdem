const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const PORT = Number(process.env.PARTY_PORT || 3000);
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_PLAYERS = 20;

const GAME_TYPES = Object.freeze({
  QUIZ: 'quiz',
  MEMORY: 'memory',
  DRAW: 'draw',
});

const GAME_LABELS = Object.freeze({
  [GAME_TYPES.QUIZ]: '快问快答',
  [GAME_TYPES.MEMORY]: '翻牌冲刺',
  [GAME_TYPES.DRAW]: '你画我猜',
});

const DEFAULT_SETUP = Object.freeze({
  selectedGame: GAME_TYPES.MEMORY,
  rounds: 3,
  seconds: 20,
});

const QUIZ_PROMPTS = [
  { question: '春节通常在农历的哪个月份？', correct: '正月', wrongs: ['二月', '十一月', '腊月'] },
  { question: '“守岁”这个习俗主要发生在什么时候？', correct: '除夕夜', wrongs: ['元宵节', '端午节', '中秋节'] },
  { question: '压岁钱传统上主要寓意什么？', correct: '辟邪保平安', wrongs: ['买零食', '支付房租', '交水电费'] },
  { question: '春节期间常说“恭喜发财”，下一句通常是？', correct: '红包拿来', wrongs: ['天天喝茶', '注意休息', '早点睡觉'] },
  { question: '“年夜饭”一般在什么时候吃？', correct: '除夕晚上', wrongs: ['初一中午', '初二早上', '元宵当天'] },
  { question: '元宵节最具代表性的食物是？', correct: '汤圆', wrongs: ['月饼', '粽子', '饺子'] },
  { question: '春节联欢晚会通常在哪一天播出？', correct: '除夕', wrongs: ['初一', '初五', '正月十五'] },
  { question: '春联通常贴在哪里？', correct: '门框两侧', wrongs: ['冰箱背面', '天花板', '地板中央'] },
  { question: '春节放鞭炮传统上象征什么？', correct: '驱邪迎新', wrongs: ['提醒上班', '降温除尘', '庆祝考试'] },
  { question: '春节走亲访友时，常见第一句话是？', correct: '新年好', wrongs: ['晚安', '辛苦了', '再见'] },
  { question: '“团圆”在春节语境里最接近哪层含义？', correct: '家人相聚', wrongs: ['独自旅行', '加班开会', '深夜购物'] },
  { question: '下列哪个通常不是春节传统活动？', correct: '赛龙舟', wrongs: ['拜年', '贴春联', '放烟花'] },
  { question: '春节常见“福”字倒贴，寓意是？', correct: '福到了', wrongs: ['贴错方向', '防盗记号', '门牌编号'] },
  { question: '拜年时常见祝福语是？', correct: '万事如意', wrongs: ['一路顺风', '注意防晒', '按时睡觉'] },
];

const DRAW_WORDS = [
  '红包',
  '烟花',
  '春联',
  '饺子',
  '汤圆',
  '舞狮',
  '灯笼',
  '鞭炮',
  '团圆饭',
  '福字',
  '年夜饭',
  '拜年',
  '窗花',
  '财神',
  '压岁钱',
  '舞龙',
  '春晚',
  '吉祥',
  '元宵',
  '糖葫芦',
];

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const rooms = new Map();

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/lobby', (_req, res) => {
  res.json(buildLobbyPayload());
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function sanitizeName(name) {
  if (typeof name !== 'string') return '';
  return name.trim().slice(0, 16);
}

function sanitizeRoomTitle(name) {
  if (typeof name !== 'string') return '';
  return name.trim().slice(0, 24);
}

function sanitizeGameType(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === GAME_TYPES.QUIZ || v === GAME_TYPES.MEMORY || v === GAME_TYPES.DRAW) {
    return v;
  }
  return DEFAULT_SETUP.selectedGame;
}

function normalizeSetup(payload = {}, base = DEFAULT_SETUP) {
  const selectedGame = sanitizeGameType(payload.selectedGame || base.selectedGame);

  const limits = {
    [GAME_TYPES.QUIZ]: { roundsMin: 3, roundsMax: 12, secMin: 8, secMax: 25 },
    [GAME_TYPES.MEMORY]: { roundsMin: 1, roundsMax: 8, secMin: 10, secMax: 45 },
    [GAME_TYPES.DRAW]: { roundsMin: 1, roundsMax: 12, secMin: 20, secMax: 120 },
  };

  const l = limits[selectedGame];
  return {
    selectedGame,
    rounds: clampInt(payload.rounds, l.roundsMin, l.roundsMax, clampInt(base.rounds, l.roundsMin, l.roundsMax, l.roundsMin)),
    seconds: clampInt(payload.seconds, l.secMin, l.secMax, clampInt(base.seconds, l.secMin, l.secMax, l.secMin)),
  };
}

function shuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function roomChannel(code) {
  return `party:${code}`;
}

function gameLabel(type) {
  return GAME_LABELS[type] || GAME_LABELS[DEFAULT_SETUP.selectedGame];
}

function makeRoomCode() {
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

function allocateRoomCode() {
  for (let i = 0; i < 1000; i += 1) {
    const code = makeRoomCode();
    if (!rooms.has(code)) return code;
  }
  throw new Error('room-code-exhausted');
}

function getHostName(room) {
  const host = room.players.find((p) => p.id === room.hostId);
  return host ? host.name : '未知';
}

function ensureUniqueName(room, rawName) {
  const base = sanitizeName(rawName) || '玩家';
  const used = new Set(room.players.map((p) => p.name));
  if (!used.has(base)) return base;
  for (let i = 2; i <= 99; i += 1) {
    const n = `${base}${i}`;
    if (!used.has(n)) return n;
  }
  return `${base}${Date.now() % 100}`;
}

function clearRoomTimer(room) {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
}

function resetPlayersForNewGame(room) {
  room.players.forEach((p) => {
    p.score = 0;
    p.correct = 0;
    p.wrong = 0;
    p.lastGain = 0;
    p.answered = false;
    p.answerChoice = null;
    p.roundScore = 0;
  });
}

function playerPublic(player, room) {
  return {
    id: player.id,
    name: player.name,
    isHost: player.id === room.hostId,
    score: player.score,
    correct: player.correct,
    wrong: player.wrong,
    lastGain: player.lastGain,
    answered: player.answered,
    answerChoice: player.answerChoice,
    roundScore: player.roundScore,
  };
}

function roomSummary(room) {
  return {
    code: room.code,
    title: room.title,
    hostName: getHostName(room),
    players: room.players.length,
    stage: room.stage,
    selectedGame: room.setup.selectedGame,
    selectedGameLabel: gameLabel(room.setup.selectedGame),
    createdAt: room.createdAt,
  };
}

function buildLobbyPayload() {
  return {
    rooms: [...rooms.values()]
      .map(roomSummary)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 100),
    serverNow: Date.now(),
  };
}

function emitLobby() {
  io.emit('partyLobby', buildLobbyPayload());
}

function buildSharedGameState(room) {
  if (!room.game) return null;

  const g = room.game;
  if (g.type === GAME_TYPES.QUIZ) {
    const reveal = g.phase === 'quiz_reveal';
    const q = g.questions[g.roundIndex] || null;
    return {
      type: g.type,
      label: gameLabel(g.type),
      phase: g.phase,
      roundNo: g.roundIndex + 1,
      totalRounds: g.totalRounds,
      roundEndsAt: g.roundEndsAt,
      question: q ? q.question : null,
      options: q ? q.options : [],
      correctIndex: q && reveal ? q.answer : null,
    };
  }

  if (g.type === GAME_TYPES.MEMORY) {
    return {
      type: g.type,
      label: gameLabel(g.type),
      phase: g.phase,
      roundNo: g.roundIndex + 1,
      totalRounds: g.totalRounds,
      roundEndsAt: g.roundEndsAt,
    };
  }

  const drawer = room.players.find((p) => p.id === g.drawerId);
  return {
    type: g.type,
    label: gameLabel(g.type),
    phase: g.phase,
    roundNo: g.roundIndex + 1,
    totalRounds: g.totalRounds,
    roundEndsAt: g.roundEndsAt,
    drawerId: g.drawerId,
    drawerName: drawer ? drawer.name : '未知',
    guessedCount: g.guessed ? g.guessed.size : 0,
    guesses: (g.guesses || []).slice(-10),
    revealWord: g.phase === 'draw_reveal' ? g.word : null,
  };
}

function buildRoomState(room) {
  return {
    room: {
      code: room.code,
      title: room.title,
      stage: room.stage,
      hostId: room.hostId,
      hostName: getHostName(room),
      setup: {
        selectedGame: room.setup.selectedGame,
        selectedGameLabel: gameLabel(room.setup.selectedGame),
        rounds: room.setup.rounds,
        seconds: room.setup.seconds,
      },
      players: room.players.map((p) => playerPublic(p, room)),
      game: buildSharedGameState(room),
    },
    serverNow: Date.now(),
  };
}

function emitRoom(room) {
  io.to(roomChannel(room.code)).emit('partyState', buildRoomState(room));
}

function removeRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  clearRoomTimer(room);
  rooms.delete(code);
  emitLobby();
}

function findRoomOfSocket(socket) {
  const code = socket.data.roomCode;
  if (!code) return null;
  return rooms.get(code) || null;
}

function maybeReassignHost(room) {
  if (room.players.some((p) => p.id === room.hostId)) return;
  room.hostId = room.players[0] ? room.players[0].id : null;
}

function leaveRoom(socket, silent = false) {
  const room = findRoomOfSocket(socket);
  if (!room) {
    socket.data.roomCode = null;
    return;
  }

  socket.leave(roomChannel(room.code));
  socket.data.roomCode = null;

  const idx = room.players.findIndex((p) => p.id === socket.id);
  if (idx >= 0) {
    room.players.splice(idx, 1);
  }

  maybeReassignHost(room);

  if (!room.players.length) {
    removeRoom(room.code);
    return;
  }

  if (room.stage === 'playing' && room.game) {
    if (room.game.type === GAME_TYPES.QUIZ && room.game.phase === 'quiz_question') {
      if (room.players.every((p) => p.answered)) {
        finalizeQuizRound(room.code);
        return;
      }
    }

    if (room.game.type === GAME_TYPES.DRAW && room.game.phase === 'draw_play') {
      if (room.game.drawerId === socket.id) {
        finalizeDrawRound(room.code, true);
        return;
      }
      const others = room.players.filter((p) => p.id !== room.game.drawerId);
      if (others.length && others.every((p) => room.game.guessed.has(p.id))) {
        finalizeDrawRound(room.code, false);
        return;
      }
    }
  }

  if (!silent) {
    emitRoom(room);
  }
  emitLobby();
}

function sendError(socket, message) {
  socket.emit('partyError', { message });
}

function makeQuizQuestion() {
  const prompt = pickRandom(QUIZ_PROMPTS);
  const options = shuffle([prompt.correct, ...prompt.wrongs.slice(0, 3)]);
  return {
    question: prompt.question,
    options,
    answer: options.indexOf(prompt.correct),
    baseScore: 100,
  };
}

function buildQuizQuestions(count) {
  const n = Math.max(1, count);
  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push(makeQuizQuestion());
  }
  return out;
}

function startQuizRound(room, roundIndex) {
  const g = room.game;
  g.roundIndex = roundIndex;
  g.phase = 'quiz_question';
  g.roundEndsAt = Date.now() + g.seconds * 1000;
  g.answers = new Map();

  room.players.forEach((p) => {
    p.answered = false;
    p.answerChoice = null;
    p.lastGain = 0;
    p.roundScore = 0;
  });

  emitRoom(room);

  clearRoomTimer(room);
  room.timer = setTimeout(() => finalizeQuizRound(room.code), g.seconds * 1000 + 30);
}

function finalizeQuizRound(code) {
  const room = rooms.get(code);
  if (!room || room.stage !== 'playing' || !room.game || room.game.type !== GAME_TYPES.QUIZ) return;
  const g = room.game;
  if (g.phase !== 'quiz_question') return;

  clearRoomTimer(room);
  g.phase = 'quiz_reveal';

  const q = g.questions[g.roundIndex];
  room.players.forEach((p) => {
    const sub = g.answers.get(p.id);
    p.answered = Boolean(sub);
    p.answerChoice = sub ? sub.choice : null;

    if (!sub) {
      p.lastGain = 0;
      return;
    }

    if (sub.choice === q.answer) {
      const leftMs = Math.max(0, g.roundEndsAt - sub.at);
      const speedBonus = Math.min(120, Math.floor(leftMs / 100));
      const gain = q.baseScore + speedBonus;
      p.score += gain;
      p.correct += 1;
      p.lastGain = gain;
      p.roundScore = gain;
    } else {
      p.wrong += 1;
      p.lastGain = 0;
      p.roundScore = 0;
    }
  });

  emitRoom(room);

  room.timer = setTimeout(() => {
    if (!rooms.has(code)) return;
    if (g.roundIndex + 1 >= g.totalRounds) {
      finishGame(room);
      return;
    }
    startQuizRound(room, g.roundIndex + 1);
  }, 2300);
}

function startMemoryRound(room, roundIndex) {
  const g = room.game;
  g.roundIndex = roundIndex;
  g.phase = 'memory_play';
  g.roundEndsAt = Date.now() + g.seconds * 1000;

  room.players.forEach((p) => {
    p.roundScore = 0;
    p.lastGain = 0;
    p.answered = false;
    p.answerChoice = null;
  });

  emitRoom(room);

  clearRoomTimer(room);
  room.timer = setTimeout(() => finalizeMemoryRound(room.code), g.seconds * 1000 + 30);
}

function finalizeMemoryRound(code) {
  const room = rooms.get(code);
  if (!room || room.stage !== 'playing' || !room.game || room.game.type !== GAME_TYPES.MEMORY) return;
  const g = room.game;
  if (g.phase !== 'memory_play') return;

  clearRoomTimer(room);
  g.phase = 'memory_reveal';
  room.players.forEach((p) => {
    const gain = Math.max(0, p.roundScore || 0);
    p.score += gain;
    p.lastGain = gain;
  });

  emitRoom(room);

  room.timer = setTimeout(() => {
    if (!rooms.has(code)) return;
    if (g.roundIndex + 1 >= g.totalRounds) {
      finishGame(room);
      return;
    }
    startMemoryRound(room, g.roundIndex + 1);
  }, 1800);
}

function normalizeGuess(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function startDrawRound(room, roundIndex) {
  const g = room.game;
  g.roundIndex = roundIndex;
  g.phase = 'draw_play';
  g.roundEndsAt = Date.now() + g.seconds * 1000;
  g.drawerId = g.order[roundIndex % g.order.length];
  g.word = pickRandom(DRAW_WORDS);
  g.guessed = new Set();
  g.guesses = [];
  g.drawerGain = 0;

  room.players.forEach((p) => {
    p.answered = false;
    p.answerChoice = null;
    p.lastGain = 0;
    p.roundScore = 0;
  });

  emitRoom(room);
  io.to(g.drawerId).emit('partyDrawWord', {
    word: g.word,
    roundNo: g.roundIndex + 1,
    totalRounds: g.totalRounds,
  });

  clearRoomTimer(room);
  room.timer = setTimeout(() => finalizeDrawRound(room.code, false), g.seconds * 1000 + 30);
}

function finalizeDrawRound(code, forceByDrawerLeave) {
  const room = rooms.get(code);
  if (!room || room.stage !== 'playing' || !room.game || room.game.type !== GAME_TYPES.DRAW) return;
  const g = room.game;
  if (g.phase !== 'draw_play') return;

  clearRoomTimer(room);
  g.phase = 'draw_reveal';

  if (forceByDrawerLeave) {
    g.guesses.push({
      name: '系统',
      text: '画手离开，本轮提前结束',
      ok: false,
      at: Date.now(),
    });
  }

  emitRoom(room);

  room.timer = setTimeout(() => {
    if (!rooms.has(code)) return;
    if (g.roundIndex + 1 >= g.totalRounds) {
      finishGame(room);
      return;
    }
    startDrawRound(room, g.roundIndex + 1);
  }, 2600);
}

function finishGame(room) {
  clearRoomTimer(room);
  room.stage = 'result';
  emitRoom(room);
  emitLobby();
}

function startGame(room) {
  resetPlayersForNewGame(room);
  const setup = room.setup;

  if (setup.selectedGame === GAME_TYPES.QUIZ) {
    room.game = {
      type: GAME_TYPES.QUIZ,
      totalRounds: setup.rounds,
      seconds: setup.seconds,
      roundIndex: 0,
      phase: 'quiz_question',
      roundEndsAt: null,
      questions: buildQuizQuestions(setup.rounds),
      answers: new Map(),
    };
    room.stage = 'playing';
    emitLobby();
    startQuizRound(room, 0);
    return;
  }

  if (setup.selectedGame === GAME_TYPES.MEMORY) {
    room.game = {
      type: GAME_TYPES.MEMORY,
      totalRounds: setup.rounds,
      seconds: setup.seconds,
      roundIndex: 0,
      phase: 'memory_play',
      roundEndsAt: null,
    };
    room.stage = 'playing';
    emitLobby();
    startMemoryRound(room, 0);
    return;
  }

  room.game = {
    type: GAME_TYPES.DRAW,
    totalRounds: setup.rounds,
    seconds: setup.seconds,
    roundIndex: 0,
    phase: 'draw_play',
    roundEndsAt: null,
    order: shuffle(room.players.map((p) => p.id)),
    drawerId: null,
    word: '',
    guessed: new Set(),
    guesses: [],
    drawerGain: 0,
  };
  room.stage = 'playing';
  emitLobby();
  startDrawRound(room, 0);
}

io.on('connection', (socket) => {
  socket.data.roomCode = null;

  socket.emit('partyLobby', buildLobbyPayload());

  socket.on('partyListRooms', () => {
    socket.emit('partyLobby', buildLobbyPayload());
  });

  socket.on('partyCreateRoom', (payload = {}) => {
    const name = sanitizeName(payload.name);
    if (!name) {
      sendError(socket, '请输入昵称');
      return;
    }

    leaveRoom(socket, true);

    const code = allocateRoomCode();
    const title = sanitizeRoomTitle(payload.title) || `派对局-${code}`;

    const host = {
      id: socket.id,
      name,
      score: 0,
      correct: 0,
      wrong: 0,
      lastGain: 0,
      answered: false,
      answerChoice: null,
      roundScore: 0,
    };

    const room = {
      code,
      title,
      hostId: socket.id,
      stage: 'lobby',
      setup: normalizeSetup(payload.setup || {}, DEFAULT_SETUP),
      players: [host],
      game: null,
      timer: null,
      createdAt: Date.now(),
    };

    rooms.set(code, room);
    socket.join(roomChannel(code));
    socket.data.roomCode = code;

    emitRoom(room);
    emitLobby();
  });

  socket.on('partyJoinRoom', (payload = {}) => {
    const code = String(payload.code || '').trim().toUpperCase();
    const name = sanitizeName(payload.name);

    if (!name) {
      sendError(socket, '请输入昵称');
      return;
    }

    if (!/^[A-Z0-9]{6}$/.test(code)) {
      sendError(socket, '房间码应为 6 位字母数字');
      return;
    }

    const room = rooms.get(code);
    if (!room) {
      sendError(socket, '房间不存在');
      return;
    }

    if (room.stage === 'playing') {
      sendError(socket, '游戏进行中，暂不支持中途加入');
      return;
    }

    if (room.players.length >= MAX_PLAYERS) {
      sendError(socket, '房间人数已满');
      return;
    }

    leaveRoom(socket, true);

    const player = {
      id: socket.id,
      name: ensureUniqueName(room, name),
      score: 0,
      correct: 0,
      wrong: 0,
      lastGain: 0,
      answered: false,
      answerChoice: null,
      roundScore: 0,
    };

    room.players.push(player);
    socket.join(roomChannel(code));
    socket.data.roomCode = code;

    emitRoom(room);
    emitLobby();
  });

  socket.on('partyLeaveRoom', () => {
    leaveRoom(socket);
  });

  socket.on('partyUpdateSetup', (payload = {}) => {
    const room = findRoomOfSocket(socket);
    if (!room) return;

    if (room.hostId !== socket.id) {
      sendError(socket, '只有房主可以修改配置');
      return;
    }

    if (room.stage === 'playing') {
      sendError(socket, '游戏进行中，不能改配置');
      return;
    }

    room.setup = normalizeSetup(payload, room.setup);
    emitRoom(room);
    emitLobby();
  });

  socket.on('partyStart', () => {
    const room = findRoomOfSocket(socket);
    if (!room) return;

    if (room.hostId !== socket.id) {
      sendError(socket, '只有房主可以开始');
      return;
    }

    if (room.players.length < 2) {
      sendError(socket, '至少 2 人才能开始');
      return;
    }

    if (room.stage === 'playing') {
      sendError(socket, '游戏已在进行中');
      return;
    }

    startGame(room);
  });

  socket.on('partyBackLobby', () => {
    const room = findRoomOfSocket(socket);
    if (!room) return;

    if (room.hostId !== socket.id) {
      sendError(socket, '只有房主可以执行此操作');
      return;
    }

    if (room.stage === 'playing') {
      sendError(socket, '请等待当前局结束');
      return;
    }

    clearRoomTimer(room);
    room.stage = 'lobby';
    room.game = null;
    resetPlayersForNewGame(room);
    emitRoom(room);
    emitLobby();
  });

  socket.on('partyAnswer', (payload = {}) => {
    const room = findRoomOfSocket(socket);
    if (!room || room.stage !== 'playing' || !room.game || room.game.type !== GAME_TYPES.QUIZ) return;
    if (room.game.phase !== 'quiz_question') return;

    const player = room.players.find((p) => p.id === socket.id);
    if (!player || player.answered) return;

    const choice = clampInt(payload.choice, 0, 3, -1);
    if (choice < 0 || choice > 3) {
      sendError(socket, '答案无效');
      return;
    }

    player.answered = true;
    player.answerChoice = choice;
    room.game.answers.set(player.id, { choice, at: Date.now() });

    emitRoom(room);

    if (room.players.every((p) => p.answered)) {
      finalizeQuizRound(room.code);
    }
  });

  socket.on('partyMemoryUpdate', (payload = {}) => {
    const room = findRoomOfSocket(socket);
    if (!room || room.stage !== 'playing' || !room.game || room.game.type !== GAME_TYPES.MEMORY) return;
    if (room.game.phase !== 'memory_play') return;

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;

    const score = clampInt(payload.score, 0, 9999, 0);
    if (score < player.roundScore) return;

    player.roundScore = score;
    emitRoom(room);
  });

  socket.on('partyDrawStroke', (payload = {}) => {
    const room = findRoomOfSocket(socket);
    if (!room || room.stage !== 'playing' || !room.game || room.game.type !== GAME_TYPES.DRAW) return;
    if (room.game.phase !== 'draw_play') return;
    if (room.game.drawerId !== socket.id) return;

    const x0 = Number(payload.x0);
    const y0 = Number(payload.y0);
    const x1 = Number(payload.x1);
    const y1 = Number(payload.y1);
    const size = clampInt(payload.size, 1, 24, 4);
    const color = String(payload.color || '#2c0505').slice(0, 20);

    if (![x0, y0, x1, y1].every(Number.isFinite)) return;

    socket.to(roomChannel(room.code)).emit('partyDrawStroke', {
      x0: Math.max(0, Math.min(1, x0)),
      y0: Math.max(0, Math.min(1, y0)),
      x1: Math.max(0, Math.min(1, x1)),
      y1: Math.max(0, Math.min(1, y1)),
      size,
      color,
    });
  });

  socket.on('partyDrawClear', () => {
    const room = findRoomOfSocket(socket);
    if (!room || room.stage !== 'playing' || !room.game || room.game.type !== GAME_TYPES.DRAW) return;
    if (room.game.phase !== 'draw_play') return;
    if (room.game.drawerId !== socket.id) return;

    socket.to(roomChannel(room.code)).emit('partyDrawClear');
  });

  socket.on('partyDrawGuess', (payload = {}) => {
    const room = findRoomOfSocket(socket);
    if (!room || room.stage !== 'playing' || !room.game || room.game.type !== GAME_TYPES.DRAW) return;
    const g = room.game;
    if (g.phase !== 'draw_play') return;

    if (socket.id === g.drawerId) {
      sendError(socket, '画手不能猜词');
      return;
    }

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;

    const text = String(payload.text || '').trim().slice(0, 24);
    if (!text) return;

    if (g.guessed.has(player.id)) return;

    const ok = normalizeGuess(text) === normalizeGuess(g.word);

    if (ok) {
      g.guessed.add(player.id);
      player.answered = true;

      const leftMs = Math.max(0, g.roundEndsAt - Date.now());
      const speedBonus = Math.min(120, Math.floor(leftMs / 100));
      const gain = 120 + speedBonus;

      player.score += gain;
      player.correct += 1;
      player.lastGain = gain;

      const drawer = room.players.find((p) => p.id === g.drawerId);
      if (drawer) {
        g.drawerGain += 60;
        drawer.score += 60;
        drawer.lastGain = g.drawerGain;
      }

      g.guesses.push({
        name: player.name,
        text,
        ok: true,
        at: Date.now(),
      });

      emitRoom(room);

      const others = room.players.filter((p) => p.id !== g.drawerId);
      if (others.length && others.every((p) => g.guessed.has(p.id))) {
        finalizeDrawRound(room.code, false);
      }
      return;
    }

    player.wrong += 1;
    g.guesses.push({
      name: player.name,
      text,
      ok: false,
      at: Date.now(),
    });

    emitRoom(room);
  });

  socket.on('disconnect', () => {
    leaveRoom(socket, true);
  });
});

server.listen(PORT, () => {
  console.log(`Party game server running at http://localhost:${PORT}`);
});
