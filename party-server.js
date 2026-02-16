const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const PORT = Number(process.env.PARTY_PORT || 3300);
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_PLAYERS = 20;
const DEFAULT_ROUNDS = 8;
const DEFAULT_SECONDS = 12;

const GAME_MODES = Object.freeze({
  MIX: 'mix',
  QUIZ: 'quiz',
  MATH: 'math',
  FIND: 'find',
});

const MODE_LABELS = Object.freeze({
  [GAME_MODES.MIX]: '混合小游戏',
  [GAME_MODES.QUIZ]: '新春知识题',
  [GAME_MODES.MATH]: '心算冲刺',
  [GAME_MODES.FIND]: '找字手速',
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
];

const FIND_SETS = [
  { target: '福', decoys: ['春', '喜', '财', '禄', '旺', '安'] },
  { target: '春', decoys: ['泰', '安', '乐', '福', '祥', '庆'] },
  { target: '财', decoys: ['福', '禄', '旺', '富', '禧', '喜'] },
  { target: '喜', decoys: ['囍', '禧', '嘉', '庆', '福', '吉'] },
  { target: '安', decoys: ['宁', '福', '康', '泰', '和', '乐'] },
  { target: '旺', decoys: ['盛', '发', '财', '兴', '昌', '隆'] },
];

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const partyRooms = new Map();

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (_req, res) => {
  res.redirect('/chuxi-quiz-battle.html');
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

function sanitizeMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === GAME_MODES.QUIZ || mode === GAME_MODES.MATH || mode === GAME_MODES.FIND) return mode;
  return GAME_MODES.MIX;
}

function roomChannel(code) {
  return `party:${code}`;
}

function shuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
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
    if (!partyRooms.has(code)) return code;
  }
  throw new Error('room-code-exhausted');
}

function ensureUniqueName(room, rawName) {
  const base = sanitizeName(rawName) || '玩家';
  const used = new Set(room.players.map((p) => p.name));
  if (!used.has(base)) return base;

  let suffix = 2;
  while (suffix <= 99) {
    const candidate = `${base}${suffix}`;
    if (!used.has(candidate)) return candidate;
    suffix += 1;
  }
  return `${base}${Date.now() % 100}`;
}

function clearRoomTimer(room) {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
}

function getRoomHostName(room) {
  const host = room.players.find((p) => p.id === room.hostId);
  return host ? host.name : '未知';
}

function modeLabel(mode) {
  return MODE_LABELS[mode] || MODE_LABELS[GAME_MODES.MIX];
}

function buildLobbyPayload() {
  const rooms = [...partyRooms.values()]
    .map((room) => ({
      code: room.code,
      title: room.title,
      hostName: getRoomHostName(room),
      players: room.players.length,
      phase: room.phase,
      mode: room.mode,
      modeLabel: modeLabel(room.mode),
      createdAt: room.createdAt,
    }))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 100);

  return {
    rooms,
    serverNow: Date.now(),
  };
}

function emitLobby() {
  io.emit('partyLobby', buildLobbyPayload());
}

function playerPublicState(player) {
  return {
    id: player.id,
    name: player.name,
    score: player.score,
    correct: player.correct,
    wrong: player.wrong,
    answered: player.answered,
    answerChoice: player.answerChoice,
    lastGain: player.lastGain,
  };
}

function buildRoomState(room) {
  const reveal = room.phase === 'reveal' || room.phase === 'finished';
  const question = room.currentQuestion
    ? {
        kind: room.currentQuestion.kind,
        label: room.currentQuestion.label,
        text: room.currentQuestion.question,
        options: room.currentQuestion.options,
        correctIndex: reveal ? room.currentQuestion.answer : null,
      }
    : null;

  return {
    room: {
      code: room.code,
      title: room.title,
      mode: room.mode,
      modeLabel: modeLabel(room.mode),
      phase: room.phase,
      hostId: room.hostId,
      hostName: getRoomHostName(room),
      totalRounds: room.totalRounds,
      roundSeconds: room.roundSeconds,
      roundIndex: room.roundIndex,
      roundNo: room.roundIndex + 1,
      roundEndsAt: room.roundEndsAt,
      answeredCount: room.players.filter((p) => p.answered).length,
      players: room.players.map(playerPublicState),
      question,
    },
    serverNow: Date.now(),
  };
}

function emitRoom(room) {
  io.to(roomChannel(room.code)).emit('partyState', buildRoomState(room));
}

function removeRoom(code) {
  const room = partyRooms.get(code);
  if (!room) return;
  clearRoomTimer(room);
  partyRooms.delete(code);
  emitLobby();
}

function withShuffledOptions(correct, wrongs) {
  const options = shuffle([correct, ...wrongs.slice(0, 3)]);
  return {
    options,
    answer: options.indexOf(correct),
  };
}

function buildQuizQuestion() {
  const prompt = pickRandom(QUIZ_PROMPTS);
  const { options, answer } = withShuffledOptions(prompt.correct, prompt.wrongs);
  return {
    kind: GAME_MODES.QUIZ,
    label: modeLabel(GAME_MODES.QUIZ),
    question: prompt.question,
    options,
    answer,
    baseScore: 110,
  };
}

function buildMathQuestion() {
  const opRoll = Math.random();
  let a = clampInt(Math.random() * 30 + 8, 8, 37, 18);
  let b = clampInt(Math.random() * 18 + 2, 2, 20, 6);
  let question = '';
  let correct = 0;

  if (opRoll < 0.45) {
    question = `${a} + ${b} = ?`;
    correct = a + b;
  } else if (opRoll < 0.8) {
    if (a < b) {
      const t = a;
      a = b;
      b = t;
    }
    question = `${a} - ${b} = ?`;
    correct = a - b;
  } else {
    a = clampInt(Math.random() * 9 + 3, 3, 11, 6);
    b = clampInt(Math.random() * 8 + 2, 2, 9, 4);
    question = `${a} × ${b} = ?`;
    correct = a * b;
  }

  const wrongSet = new Set();
  while (wrongSet.size < 3) {
    const offset = clampInt(Math.random() * 9 + 1, 1, 9, 3) * (Math.random() < 0.5 ? -1 : 1);
    const candidate = Math.max(0, correct + offset);
    if (candidate !== correct) wrongSet.add(candidate);
  }

  const { options, answer } = withShuffledOptions(String(correct), [...wrongSet].map((n) => String(n)));

  return {
    kind: GAME_MODES.MATH,
    label: modeLabel(GAME_MODES.MATH),
    question,
    options,
    answer,
    baseScore: 120,
  };
}

function buildFindQuestion() {
  const set = pickRandom(FIND_SETS);
  const decoys = shuffle(set.decoys).slice(0, 3);
  const { options, answer } = withShuffledOptions(set.target, decoys);

  return {
    kind: GAME_MODES.FIND,
    label: modeLabel(GAME_MODES.FIND),
    question: `请快速找出“${set.target}”字`,
    options,
    answer,
    baseScore: 95,
  };
}

function buildQuestionByKind(kind) {
  if (kind === GAME_MODES.QUIZ) return buildQuizQuestion();
  if (kind === GAME_MODES.MATH) return buildMathQuestion();
  return buildFindQuestion();
}

function pickRoundKinds(mode, totalRounds) {
  if (mode !== GAME_MODES.MIX) {
    return Array(totalRounds).fill(mode);
  }

  const kinds = [GAME_MODES.QUIZ, GAME_MODES.MATH, GAME_MODES.FIND];
  const result = [];
  let deck = shuffle(kinds);

  for (let i = 0; i < totalRounds; i += 1) {
    if (!deck.length) {
      deck = shuffle(kinds);
    }
    result.push(deck.pop());
  }

  return result;
}

function pickQuestions(totalRounds, mode) {
  const kinds = pickRoundKinds(mode, totalRounds);
  return kinds.map((kind) => buildQuestionByKind(kind));
}

function resetPlayersForNewMatch(room) {
  room.players.forEach((p) => {
    p.score = 0;
    p.correct = 0;
    p.wrong = 0;
    p.answered = false;
    p.answerChoice = null;
    p.lastGain = 0;
  });
}

function startRound(room) {
  clearRoomTimer(room);

  room.phase = 'question';
  room.roundAnswers = new Map();
  room.currentQuestion = room.questions[room.roundIndex] || null;
  room.roundEndsAt = Date.now() + room.roundSeconds * 1000;

  room.players.forEach((p) => {
    p.answered = false;
    p.answerChoice = null;
    p.lastGain = 0;
  });

  emitRoom(room);

  room.timer = setTimeout(() => {
    finalizeRound(room.code);
  }, room.roundSeconds * 1000 + 20);
}

function finalizeRound(code) {
  const room = partyRooms.get(code);
  if (!room || room.phase !== 'question' || !room.currentQuestion) return;

  clearRoomTimer(room);
  room.phase = 'reveal';

  const answer = room.currentQuestion.answer;
  room.players.forEach((player) => {
    const submission = room.roundAnswers.get(player.id);
    player.answered = Boolean(submission);
    player.answerChoice = submission ? submission.choice : null;

    if (!submission) {
      player.lastGain = 0;
      return;
    }

    if (submission.choice === answer) {
      const leftMs = Math.max(0, room.roundEndsAt - submission.at);
      const speedBonus = Math.min(120, Math.floor(leftMs / 100));
      const gain = room.currentQuestion.baseScore + speedBonus;
      player.score += gain;
      player.correct += 1;
      player.lastGain = gain;
    } else {
      player.wrong += 1;
      player.lastGain = 0;
    }
  });

  emitRoom(room);

  room.timer = setTimeout(() => {
    nextRoundOrFinish(room.code);
  }, 2800);
}

function nextRoundOrFinish(code) {
  const room = partyRooms.get(code);
  if (!room) return;

  if (room.roundIndex + 1 >= room.questions.length) {
    clearRoomTimer(room);
    room.phase = 'finished';
    room.roundEndsAt = null;
    emitRoom(room);
    emitLobby();
    return;
  }

  room.roundIndex += 1;
  startRound(room);
}

function startMatch(room) {
  room.questions = pickQuestions(room.totalRounds, room.mode);
  room.roundIndex = 0;
  room.currentQuestion = null;
  room.roundEndsAt = null;
  resetPlayersForNewMatch(room);
  startRound(room);
  emitLobby();
}

function partyRoomOfSocket(socket) {
  const code = socket.data.partyRoomCode;
  if (!code) return null;
  return partyRooms.get(code) || null;
}

function removePlayerFromRoom(room, socketId) {
  const idx = room.players.findIndex((p) => p.id === socketId);
  if (idx < 0) return null;
  const [removed] = room.players.splice(idx, 1);
  return removed;
}

function maybeReassignHost(room) {
  if (room.players.some((p) => p.id === room.hostId)) return;
  room.hostId = room.players[0] ? room.players[0].id : null;
}

function leavePartyRoom(socket, silent = false) {
  const room = partyRoomOfSocket(socket);
  if (!room) {
    socket.data.partyRoomCode = null;
    return;
  }

  socket.leave(roomChannel(room.code));
  socket.data.partyRoomCode = null;

  const removed = removePlayerFromRoom(room, socket.id);
  if (!removed) {
    emitLobby();
    return;
  }

  maybeReassignHost(room);

  if (room.players.length === 0) {
    removeRoom(room.code);
    return;
  }

  if (room.phase === 'question') {
    const allAnswered = room.players.every((p) => p.answered);
    if (allAnswered) {
      finalizeRound(room.code);
      return;
    }
  }

  if (!silent) {
    emitRoom(room);
  }
  emitLobby();
}

function sendPartyError(socket, message) {
  socket.emit('partyError', { message });
}

io.on('connection', (socket) => {
  socket.data.partyRoomCode = null;

  socket.emit('partyLobby', buildLobbyPayload());

  socket.on('partyListRooms', () => {
    socket.emit('partyLobby', buildLobbyPayload());
  });

  socket.on('partyCreateRoom', (payload = {}) => {
    const name = sanitizeName(payload.name);
    if (!name) {
      sendPartyError(socket, '请输入昵称');
      return;
    }

    leavePartyRoom(socket, true);

    const code = allocateRoomCode();
    const title = sanitizeRoomTitle(payload.title) || `除夕局-${code}`;
    const totalRounds = clampInt(payload.totalRounds, 3, 12, DEFAULT_ROUNDS);
    const roundSeconds = clampInt(payload.roundSeconds, 8, 25, DEFAULT_SECONDS);
    const mode = sanitizeMode(payload.mode);

    const hostPlayer = {
      id: socket.id,
      name,
      score: 0,
      correct: 0,
      wrong: 0,
      answered: false,
      answerChoice: null,
      lastGain: 0,
    };

    const room = {
      code,
      title,
      mode,
      hostId: socket.id,
      phase: 'lobby',
      createdAt: Date.now(),
      players: [hostPlayer],
      totalRounds,
      roundSeconds,
      questions: [],
      roundIndex: -1,
      roundAnswers: new Map(),
      currentQuestion: null,
      roundEndsAt: null,
      timer: null,
    };

    partyRooms.set(code, room);
    socket.join(roomChannel(code));
    socket.data.partyRoomCode = code;

    emitRoom(room);
    emitLobby();
  });

  socket.on('partyJoinRoom', (payload = {}) => {
    const name = sanitizeName(payload.name);
    const code = String(payload.code || '').toUpperCase().trim();

    if (!name) {
      sendPartyError(socket, '请输入昵称');
      return;
    }

    const room = partyRooms.get(code);
    if (!room) {
      sendPartyError(socket, '房间不存在');
      return;
    }

    if (room.phase !== 'lobby') {
      sendPartyError(socket, '该房间已开始，暂不支持中途加入');
      return;
    }

    if (room.players.length >= MAX_PLAYERS) {
      sendPartyError(socket, '房间人数已满');
      return;
    }

    leavePartyRoom(socket, true);

    const player = {
      id: socket.id,
      name: ensureUniqueName(room, name),
      score: 0,
      correct: 0,
      wrong: 0,
      answered: false,
      answerChoice: null,
      lastGain: 0,
    };

    room.players.push(player);
    socket.join(roomChannel(code));
    socket.data.partyRoomCode = code;

    emitRoom(room);
    emitLobby();
  });

  socket.on('partyLeaveRoom', () => {
    leavePartyRoom(socket);
  });

  socket.on('partyStart', () => {
    const room = partyRoomOfSocket(socket);
    if (!room) return;

    if (room.hostId !== socket.id) {
      sendPartyError(socket, '只有房主可以开始');
      return;
    }

    if (room.phase !== 'lobby' && room.phase !== 'finished') {
      sendPartyError(socket, '当前回合未结束');
      return;
    }

    if (room.players.length < 2) {
      sendPartyError(socket, '至少 2 人才能开始');
      return;
    }

    startMatch(room);
  });

  socket.on('partyResetLobby', () => {
    const room = partyRoomOfSocket(socket);
    if (!room) return;

    if (room.hostId !== socket.id) {
      sendPartyError(socket, '只有房主可以重置');
      return;
    }

    clearRoomTimer(room);
    room.phase = 'lobby';
    room.roundIndex = -1;
    room.roundEndsAt = null;
    room.currentQuestion = null;
    room.questions = [];
    room.roundAnswers = new Map();
    resetPlayersForNewMatch(room);

    emitRoom(room);
    emitLobby();
  });

  socket.on('partyAnswer', (payload = {}) => {
    const room = partyRoomOfSocket(socket);
    if (!room || room.phase !== 'question') return;

    const player = room.players.find((p) => p.id === socket.id);
    if (!player || player.answered) return;

    const choice = clampInt(payload.choice, 0, 3, -1);
    if (choice < 0 || choice > 3) {
      sendPartyError(socket, '答案无效');
      return;
    }

    player.answered = true;
    player.answerChoice = choice;
    room.roundAnswers.set(player.id, {
      choice,
      at: Date.now(),
    });

    emitRoom(room);

    if (room.players.every((p) => p.answered)) {
      finalizeRound(room.code);
    }
  });

  socket.on('disconnect', () => {
    leavePartyRoom(socket, true);
  });
});

server.listen(PORT, () => {
  console.log(`Party quiz server running at http://localhost:${PORT}`);
});
