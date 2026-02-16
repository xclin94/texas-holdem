const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const PORT = Number(process.env.PARTY_PORT || 3300);
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_PLAYERS = 20;
const DEFAULT_ROUNDS = 8;
const DEFAULT_SECONDS = 12;

const QUIZ_BANK = [
  {
    question: '春节通常在农历的哪个月份？',
    options: ['正月', '二月', '十一月', '腊月'],
    answer: 0,
  },
  {
    question: '“守岁”这个习俗主要发生在什么时候？',
    options: ['除夕夜', '元宵节', '端午节', '中秋节'],
    answer: 0,
  },
  {
    question: '下列哪一项最常见于春节贴在门上的装饰？',
    options: ['窗花和春联', '风铃', '圣诞袜', '万圣节南瓜灯'],
    answer: 0,
  },
  {
    question: '压岁钱传统上主要寓意什么？',
    options: ['辟邪保平安', '买零食', '支付房租', '交水电费'],
    answer: 0,
  },
  {
    question: '春节期间常说“恭喜发财”，下一句通常是？',
    options: ['红包拿来', '天天喝茶', '注意休息', '早点睡觉'],
    answer: 0,
  },
  {
    question: '“年夜饭”一般在什么时候吃？',
    options: ['除夕晚上', '初一中午', '初二早上', '元宵当天'],
    answer: 0,
  },
  {
    question: '下列哪个通常不是春节的传统活动？',
    options: ['赛龙舟', '拜年', '贴春联', '放烟花'],
    answer: 0,
  },
  {
    question: '春节常见的“福”字倒贴，寓意是什么？',
    options: ['福到了', '字写错了', '纸贴歪了', '为了省胶水'],
    answer: 0,
  },
  {
    question: '元宵节最具代表性的食物是？',
    options: ['汤圆', '月饼', '粽子', '饺子'],
    answer: 0,
  },
  {
    question: '春节联欢晚会通常在哪一天播出？',
    options: ['除夕', '初一', '初五', '正月十五'],
    answer: 0,
  },
  {
    question: '“拜年”通常表达哪种心意？',
    options: ['祝福问候', '借钱', '道歉', '签合同'],
    answer: 0,
  },
  {
    question: '大多数地区春节期间常见的主色调是？',
    options: ['红色和金色', '蓝色和灰色', '黑色和白色', '绿色和紫色'],
    answer: 0,
  },
  {
    question: '春联通常贴在哪里？',
    options: ['门框两侧', '冰箱背面', '天花板', '地板中央'],
    answer: 0,
  },
  {
    question: '春节放鞭炮传统上象征什么？',
    options: ['驱邪迎新', '提醒上班', '降温除尘', '庆祝考试'],
    answer: 0,
  },
  {
    question: '春节走亲访友时，常见第一句话是？',
    options: ['新年好', '晚安', '辛苦了', '再见'],
    answer: 0,
  },
  {
    question: '“团圆”在春节语境里最接近哪层含义？',
    options: ['家人相聚', '独自旅行', '加班开会', '深夜购物'],
    answer: 0,
  },
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

function buildLobbyPayload() {
  const rooms = [...partyRooms.values()]
    .map((room) => ({
      code: room.code,
      title: room.title,
      hostName: getRoomHostName(room),
      players: room.players.length,
      phase: room.phase,
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
        text: room.currentQuestion.question,
        options: room.currentQuestion.options,
        correctIndex: reveal ? room.currentQuestion.answer : null,
      }
    : null;

  return {
    room: {
      code: room.code,
      title: room.title,
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

function pickQuestions(count) {
  return shuffle(QUIZ_BANK).slice(0, Math.min(Math.max(1, count), QUIZ_BANK.length));
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
      const gain = 100 + speedBonus;
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
  room.questions = pickQuestions(room.totalRounds);
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
