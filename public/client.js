const socket = io();

let lobbyState = { rooms: [], serverNow: Date.now() };
let roomState = null;
let meId = null;
let replayState = null;
let lastLobbyFetchAt = 0;

const $ = (id) => document.getElementById(id);

const el = {
  lobbyView: $('lobbyView'),
  tableView: $('tableView'),
  notice: $('notice'),
  tableNotice: $('tableNotice'),

  nameInput: $('nameInput'),
  createRoomNameInput: $('createRoomNameInput'),
  createPasswordInput: $('createPasswordInput'),
  createSessionInput: $('createSessionInput'),
  createStackInput: $('createStackInput'),
  createSbInput: $('createSbInput'),
  createBbInput: $('createBbInput'),
  createMaxPlayersInput: $('createMaxPlayersInput'),
  createTurnInput: $('createTurnInput'),
  createBlindIntervalInput: $('createBlindIntervalInput'),
  createTournamentInput: $('createTournamentInput'),
  createStraddleInput: $('createStraddleInput'),
  createSpectatorInput: $('createSpectatorInput'),

  joinRoomInput: $('joinRoomInput'),
  joinPasswordInput: $('joinPasswordInput'),
  joinSpectatorInput: $('joinSpectatorInput'),

  createBtn: $('createBtn'),
  joinBtn: $('joinBtn'),
  refreshLobbyBtn: $('refreshLobbyBtn'),
  roomsList: $('roomsList'),

  roomTitle: $('roomTitle'),
  roomIdText: $('roomIdText'),
  roomModeText: $('roomModeText'),
  sessionTimer: $('sessionTimer'),
  copyRoomBtn: $('copyRoomBtn'),

  takeSeatBtn: $('takeSeatBtn'),
  becomeSpectatorBtn: $('becomeSpectatorBtn'),
  readyBtn: $('readyBtn'),
  startBtn: $('startBtn'),
  leaveBtn: $('leaveBtn'),

  phaseText: $('phaseText'),
  potText: $('potText'),
  betText: $('betText'),
  turnText: $('turnText'),
  turnTimerText: $('turnTimerText'),
  dealerText: $('dealerText'),
  sbText: $('sbText'),
  bbText: $('bbText'),
  blindText: $('blindText'),
  blindLevelText: $('blindLevelText'),
  nextBlindText: $('nextBlindText'),

  communityCards: $('communityCards'),
  seatMap: $('seatMap'),
  spectatorsList: $('spectatorsList'),
  bannedList: $('bannedList'),
  historyList: $('historyList'),
  replayBox: $('replayBox'),

  actionPanel: $('actionPanel'),
  actionInfo: $('actionInfo'),
  normalActionBox: $('normalActionBox'),
  straddleBox: $('straddleBox'),
  foldBtn: $('foldBtn'),
  checkBtn: $('checkBtn'),
  callBtn: $('callBtn'),
  allinBtn: $('allinBtn'),
  betInput: $('betInput'),
  betBtn: $('betBtn'),
  straddleInput: $('straddleInput'),
  straddleBtn: $('straddleBtn'),
  skipStraddleBtn: $('skipStraddleBtn'),

  resultPanel: $('resultPanel'),

  cfgRoomNameInput: $('cfgRoomNameInput'),
  cfgPasswordInput: $('cfgPasswordInput'),
  cfgStackInput: $('cfgStackInput'),
  cfgSbInput: $('cfgSbInput'),
  cfgBbInput: $('cfgBbInput'),
  cfgMaxPlayersInput: $('cfgMaxPlayersInput'),
  cfgTurnInput: $('cfgTurnInput'),
  cfgSessionInput: $('cfgSessionInput'),
  cfgBlindIntervalInput: $('cfgBlindIntervalInput'),
  cfgTournamentInput: $('cfgTournamentInput'),
  cfgStraddleInput: $('cfgStraddleInput'),
  cfgSpectatorInput: $('cfgSpectatorInput'),
  saveConfigBtn: $('saveConfigBtn'),

  logs: $('logs'),
  chatInput: $('chatInput'),
  sendChatBtn: $('sendChatBtn'),
};

function showNotice(target, msg) {
  if (!msg) {
    target.classList.add('hidden');
    target.textContent = '';
    return;
  }
  target.classList.remove('hidden');
  target.textContent = msg;
}

function persistName() {
  localStorage.setItem('holdem_name', el.nameInput.value.trim());
}

function loadName() {
  const v = localStorage.getItem('holdem_name') || '';
  if (v) el.nameInput.value = v;
}

function parseNum(input, fallback) {
  const n = Number(input);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function ensureConnected() {
  if (socket.connected) return true;
  showNotice(el.notice, '网络连接中，请稍后再试');
  socket.connect();
  return false;
}

function ensureNickname() {
  let name = el.nameInput.value.trim();
  if (name) return name;
  const asked = (window.prompt('请输入昵称后加入') || '').trim();
  if (!asked) return '';
  el.nameInput.value = asked;
  persistName();
  return asked;
}

function roomPlayerById(id) {
  return roomState?.players?.find((p) => p.id === id) || null;
}

function roomMemberName(id) {
  return roomPlayerById(id)?.name || roomState?.spectators?.find((s) => s.id === id)?.name || '-';
}

function suitSymbol(s) {
  return { S: '♠', H: '♥', D: '♦', C: '♣' }[s] || s;
}

function cardNode(code, hidden = false) {
  const node = document.createElement('div');
  node.className = `card-face${hidden ? ' back' : ''}`;
  if (!hidden) {
    node.textContent = `${code[0]}${suitSymbol(code[1])}`;
    if (code[1] === 'H' || code[1] === 'D') node.classList.add('red');
  }
  return node;
}

function phaseLabel(phase) {
  return {
    preflop: '翻牌前',
    flop: '翻牌圈',
    turn: '转牌圈',
    river: '河牌圈',
    finished: '本手结束',
  }[phase] || '等待开局';
}

function fmtClock(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function fallbackCopy(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', 'true');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  area.style.left = '-9999px';
  document.body.appendChild(area);
  area.focus();
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(area);
  return ok;
}

function getInviteLink() {
  if (!roomState?.roomId) return '';
  const url = new URL(window.location.href);
  url.searchParams.set('room', roomState.roomId);
  return url.toString();
}

function collectCreateSettings() {
  return {
    roomName: el.createRoomNameInput.value.trim(),
    password: el.createPasswordInput.value.trim(),
    settings: {
      startingStack: parseNum(el.createStackInput.value, 2000),
      smallBlind: parseNum(el.createSbInput.value, 10),
      bigBlind: parseNum(el.createBbInput.value, 20),
      maxPlayers: parseNum(el.createMaxPlayersInput.value, 9),
      turnTimeSec: parseNum(el.createTurnInput.value, 25),
      sessionMinutes: parseNum(el.createSessionInput.value, 180),
      blindIntervalMinutes: parseNum(el.createBlindIntervalInput.value, 15),
      tournamentMode: el.createTournamentInput.checked,
      allowStraddle: el.createStraddleInput.checked,
      allowSpectators: el.createSpectatorInput.checked,
    },
  };
}

function collectConfigSettings() {
  return {
    roomName: el.cfgRoomNameInput.value.trim(),
    password: el.cfgPasswordInput.value.trim(),
    settings: {
      startingStack: parseNum(el.cfgStackInput.value, 2000),
      smallBlind: parseNum(el.cfgSbInput.value, 10),
      bigBlind: parseNum(el.cfgBbInput.value, 20),
      maxPlayers: parseNum(el.cfgMaxPlayersInput.value, 9),
      turnTimeSec: parseNum(el.cfgTurnInput.value, 25),
      sessionMinutes: parseNum(el.cfgSessionInput.value, 180),
      blindIntervalMinutes: parseNum(el.cfgBlindIntervalInput.value, 15),
      tournamentMode: el.cfgTournamentInput.checked,
      allowStraddle: el.cfgStraddleInput.checked,
      allowSpectators: el.cfgSpectatorInput.checked,
    },
  };
}

function renderLobbyRooms() {
  el.roomsList.innerHTML = '';

  if (!lobbyState.rooms.length) {
    const empty = document.createElement('div');
    empty.className = 'room-item';
    empty.textContent = '暂无开放房间';
    el.roomsList.appendChild(empty);
    return;
  }

  lobbyState.rooms.forEach((room) => {
    const box = document.createElement('div');
    box.className = 'room-item';

    const top = document.createElement('div');
    top.className = 'top';

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = `${room.roomName} (${room.roomId})`;

    const actions = document.createElement('div');
    actions.className = 'actions';

    const joinBtn = document.createElement('button');
    joinBtn.className = 'btn tiny';
    joinBtn.textContent = '加入';
    joinBtn.onclick = () => quickJoin(room.roomId, false, room.hasPassword);

    actions.appendChild(joinBtn);

    if (room.allowSpectators) {
      const watchBtn = document.createElement('button');
      watchBtn.className = 'btn tiny';
      watchBtn.textContent = '观战';
      watchBtn.onclick = () => quickJoin(room.roomId, true, room.hasPassword);
      actions.appendChild(watchBtn);
    }

    top.appendChild(title);
    top.appendChild(actions);

    const meta = document.createElement('div');
    meta.className = 'meta';

    const leftSec = Math.max(0, Math.ceil((room.expiresAt - Date.now()) / 1000));
    const timeText = room.expired ? '已到期' : `剩余 ${fmtClock(leftSec)}`;
    const tournament = room.tournamentMode
      ? `锦标赛 L${room.blindLevel} 每${room.blindIntervalMinutes}分钟升级`
      : '现金桌';

    meta.textContent = `玩家 ${room.playerCount}/${room.maxPlayers} · 已准备 ${room.readyCount} · 观战 ${room.spectatorCount} · 盲注 ${room.smallBlind}/${room.bigBlind} · ${room.inGame ? '进行中' : '等待中'} · ${timeText}${room.hasPassword ? ' · 需密码' : ''}${room.allowStraddle ? ' · 支持straddle' : ''} · ${tournament}`;

    box.appendChild(top);
    box.appendChild(meta);
    el.roomsList.appendChild(box);
  });
}

function renderCommunity() {
  el.communityCards.innerHTML = '';
  const cards = roomState?.game?.community || [];
  cards.forEach((c) => el.communityCards.appendChild(cardNode(c)));
  for (let i = cards.length; i < 5; i += 1) {
    el.communityCards.appendChild(cardNode('XX', true));
  }
}

function addBadge(parent, text, klass = '') {
  const b = document.createElement('span');
  b.className = `badge ${klass}`.trim();
  b.textContent = text;
  parent.appendChild(b);
}

function createAdminButtons(targetId) {
  const host = roomState?.hostId === meId;
  if (!host || targetId === meId) return null;

  const box = document.createElement('div');
  box.className = 'mini-actions';

  const kickBtn = document.createElement('button');
  kickBtn.className = 'btn tiny';
  kickBtn.textContent = '踢出';
  kickBtn.onclick = () => socket.emit('kickMember', { targetId });

  const banBtn = document.createElement('button');
  banBtn.className = 'btn tiny danger';
  banBtn.textContent = '封禁';
  banBtn.onclick = () => socket.emit('banMember', { targetId });

  box.appendChild(kickBtn);
  box.appendChild(banBtn);
  return box;
}

function isMobileView() {
  return window.innerWidth <= 760;
}

function getSeatLayout(maxPlayers, compact) {
  const desktopLayouts = {
    2: [
      [50, 85],
      [50, 15],
    ],
    3: [
      [50, 86],
      [80, 58],
      [20, 58],
    ],
    4: [
      [50, 86],
      [84, 52],
      [50, 14],
      [16, 52],
    ],
    5: [
      [50, 87],
      [82, 66],
      [72, 18],
      [28, 18],
      [18, 66],
    ],
    6: [
      [50, 87],
      [80, 68],
      [80, 34],
      [50, 14],
      [20, 34],
      [20, 68],
    ],
    7: [
      [50, 87],
      [78, 72],
      [86, 48],
      [70, 16],
      [30, 16],
      [14, 48],
      [22, 72],
    ],
    8: [
      [50, 88],
      [72, 78],
      [86, 60],
      [86, 30],
      [72, 12],
      [28, 12],
      [14, 30],
      [14, 60],
    ],
    9: [
      [50, 88],
      [74, 80],
      [88, 60],
      [88, 34],
      [74, 12],
      [50, 8],
      [26, 12],
      [12, 34],
      [12, 60],
    ],
  };
  const mobileLayouts = {
    2: [
      [50, 86],
      [50, 15],
    ],
    3: [
      [50, 88],
      [80, 62],
      [20, 62],
    ],
    4: [
      [50, 88],
      [84, 54],
      [50, 14],
      [16, 54],
    ],
    5: [
      [50, 89],
      [80, 68],
      [72, 16],
      [28, 16],
      [20, 68],
    ],
    6: [
      [50, 90],
      [80, 72],
      [88, 46],
      [68, 16],
      [32, 16],
      [12, 46],
    ],
    7: [
      [50, 90],
      [74, 82],
      [88, 63],
      [84, 34],
      [60, 10],
      [40, 10],
      [12, 45],
    ],
    8: [
      [50, 90],
      [73, 82],
      [88, 65],
      [90, 40],
      [74, 14],
      [26, 14],
      [10, 40],
      [12, 65],
    ],
    9: [
      [50, 90],
      [72, 84],
      [86, 68],
      [89, 46],
      [84, 24],
      [50, 8],
      [16, 24],
      [11, 46],
      [14, 68],
    ],
  };

  const source = compact ? mobileLayouts : desktopLayouts;
  return source[maxPlayers] || source[9];
}

function labelsForCount(count) {
  if (count <= 0) return [];
  const map = {
    1: ['UTG'],
    2: ['UTG', 'CO'],
    3: ['UTG', 'HJ', 'CO'],
    4: ['UTG', 'LJ', 'HJ', 'CO'],
    5: ['UTG', 'UTG+1', 'LJ', 'HJ', 'CO'],
    6: ['UTG', 'UTG+1', 'MP', 'LJ', 'HJ', 'CO'],
  };
  return map[count] || Array.from({ length: count }, (_, i) => `P${i + 1}`);
}

function buildPositionLabelMap() {
  const map = new Map();
  const game = roomState?.game;
  if (!game || !game.order?.length) return map;

  const order = game.order;
  const n = order.length;

  if (n === 2) {
    map.set(game.dealerId, 'BTN/SB');
    map.set(game.bigBlindId, 'BB');
    return map;
  }

  map.set(game.dealerId, 'BTN');
  map.set(game.smallBlindId, 'SB');
  map.set(game.bigBlindId, 'BB');

  const bbIdx = order.indexOf(game.bigBlindId);
  const seq = [];
  let idx = bbIdx;
  for (let i = 0; i < n; i += 1) {
    idx = (idx + 1) % n;
    const id = order[idx];
    if (id === game.dealerId || id === game.smallBlindId || id === game.bigBlindId) continue;
    seq.push(id);
  }

  const labels = labelsForCount(seq.length);
  seq.forEach((id, i) => map.set(id, labels[i] || `P${i + 1}`));
  return map;
}

function renderSeatMap() {
  el.seatMap.innerHTML = '';
  const players = roomState?.players || [];
  const maxPlayers = roomState?.settings?.maxPlayers || 9;
  const compact = isMobileView();
  const layout = getSeatLayout(maxPlayers, compact);
  const posMap = buildPositionLabelMap();

  for (let seat = 1; seat <= maxPlayers; seat += 1) {
    const point = layout[seat - 1] || [50, 50];
    const p = players.find((x) => x.seat === seat);

    const node = document.createElement('div');
    node.className = `seat-node${p ? '' : ' empty'}${p?.id === meId ? ' me' : ''}${compact ? ' compact' : ''}`;
    node.style.left = `${point[0]}%`;
    node.style.top = `${point[1]}%`;

    if (!p) {
      node.textContent = compact ? `${seat}空位` : `${seat}号位 空位`;
      el.seatMap.appendChild(node);
      continue;
    }

    const head = document.createElement('div');
    head.className = 'seat-head';
    const pos = posMap.get(p.id) || `S${seat}`;
    head.textContent = compact ? p.name : `${p.name} · ${pos}`;

    const badges = document.createElement('div');
    badges.className = 'badges';
    if (compact) addBadge(badges, pos, 'gold');
    if (p.id === roomState.hostId) addBadge(badges, '房主', 'gold');
    if (roomState.game?.turnId === p.id && !roomState.game?.finished) addBadge(badges, '行动中', 'ok');
    if (p.ready) addBadge(badges, '已准备', 'ok');
    if (p.folded) addBadge(badges, '弃牌', 'warn');
    if (p.allIn) addBadge(badges, '全下');
    if (!p.connected) addBadge(badges, '离线', 'warn');

    const sub = document.createElement('div');
    sub.className = 'seat-sub';
    sub.textContent = compact
      ? `后手 ${p.stack} · 投入 ${p.totalContribution}`
      : `后手 ${p.stack} · 本轮 ${p.betThisStreet} · 总投入 ${p.totalContribution}`;

    const act = document.createElement('div');
    act.className = 'seat-sub';
    act.textContent = compact ? (p.lastAction || '') : (p.lastAction || '等待中');

    const cards = document.createElement('div');
    cards.className = 'seat-cards';
    if (p.holeCards?.length) {
      p.holeCards.forEach((c) => cards.appendChild(cardNode(c)));
    } else if (p.inHand && !roomState.game?.finished) {
      cards.appendChild(cardNode('XX', true));
      cards.appendChild(cardNode('XX', true));
    }

    node.appendChild(head);
    node.appendChild(badges);
    node.appendChild(sub);
    node.appendChild(act);
    if (!compact || cards.children.length > 0) {
      node.appendChild(cards);
    }

    const admin = createAdminButtons(p.id);
    if (admin) node.appendChild(admin);

    el.seatMap.appendChild(node);
  }
}

function renderSpectators() {
  el.spectatorsList.innerHTML = '';
  const list = roomState?.spectators || [];
  if (!list.length) {
    el.spectatorsList.textContent = '暂无观战';
    return;
  }

  list.forEach((s) => {
    const wrap = document.createElement('div');
    wrap.className = 'mini-actions';

    const div = document.createElement('div');
    div.className = 'spectator-item';
    div.textContent = `${s.name}${s.connected ? '' : ' (离线)'}`;
    wrap.appendChild(div);

    const admin = createAdminButtons(s.id);
    if (admin) {
      Array.from(admin.children).forEach((child) => wrap.appendChild(child));
    }

    el.spectatorsList.appendChild(wrap);
  });
}

function renderBanned() {
  el.bannedList.innerHTML = '';
  const host = roomState?.hostId === meId;

  if (!host) {
    el.bannedList.textContent = '仅房主可见';
    return;
  }

  const bans = roomState?.bannedNames || [];
  if (!bans.length) {
    el.bannedList.textContent = '暂无封禁';
    return;
  }

  bans.forEach((name) => {
    const wrap = document.createElement('div');
    wrap.className = 'mini-actions';

    const tag = document.createElement('div');
    tag.className = 'spectator-item';
    tag.textContent = name;

    const btn = document.createElement('button');
    btn.className = 'btn tiny';
    btn.textContent = '解封';
    btn.onclick = () => socket.emit('unbanName', { name });

    wrap.appendChild(tag);
    wrap.appendChild(btn);
    el.bannedList.appendChild(wrap);
  });
}

function renderHistory() {
  el.historyList.innerHTML = '';
  const list = roomState?.handHistory || [];

  if (!list.length) {
    el.historyList.textContent = '暂无战绩';
    el.replayBox.classList.add('hidden');
    return;
  }

  list.forEach((h) => {
    const item = document.createElement('div');
    item.className = 'history-item';

    const winners = (h.winners || []).map((w) => `${w.name || roomMemberName(w.playerId)} +${w.amount}`).join(' / ');
    item.innerHTML = `<strong>Hand #${h.handNo}</strong><br/>盲注 ${h.blinds?.smallBlind || '-'} / ${h.blinds?.bigBlind || '-'} (L${h.blinds?.level || 1})<br/>赢家: ${winners || '-'}`;

    const btn = document.createElement('button');
    btn.className = 'btn tiny';
    btn.textContent = '回放';
    btn.onclick = () => socket.emit('getHandReplay', { handNo: h.handNo });

    item.appendChild(document.createElement('br'));
    item.appendChild(btn);
    el.historyList.appendChild(item);
  });

  if (!replayState) {
    el.replayBox.classList.add('hidden');
  }
}

function renderReplay() {
  if (!replayState) {
    el.replayBox.classList.add('hidden');
    el.replayBox.innerHTML = '';
    return;
  }

  const lines = (replayState.actions || [])
    .map((a) => `${new Date(a.ts).toLocaleTimeString()} ${a.message}`)
    .join('<br/>');

  const winners = (replayState.result?.winners || [])
    .map((w) => `${w.name || roomMemberName(w.playerId)} +${w.amount}`)
    .join(' / ');

  el.replayBox.classList.remove('hidden');
  el.replayBox.innerHTML = `
    <h3>回放 Hand #${replayState.handNo}</h3>
    <p class="hint">盲注 ${replayState.blinds?.smallBlind || '-'} / ${replayState.blinds?.bigBlind || '-'} (L${replayState.blinds?.level || 1})</p>
    <p class="hint">赢家：${winners || '-'}</p>
    <div class="logs" style="min-height:120px;max-height:220px">${lines || '无回放动作'}</div>
  `;
}

function renderResult() {
  const result = roomState?.game?.result;
  if (!result) {
    el.resultPanel.classList.add('hidden');
    el.resultPanel.innerHTML = '';
    return;
  }

  const winners = (result.winners || [])
    .map((w) => `${w.name || roomMemberName(w.playerId)} +${w.amount}${w.hand ? ` (${w.hand})` : ''}`)
    .join(' | ');

  const side = (result.sidePots || [])
    .map((p, idx) => `池${idx + 1}: ${p.amount} -> ${(p.winners || []).map((id) => roomMemberName(id)).join('/')} ${p.handName ? `(${p.handName})` : ''}`)
    .join('<br/>');

  el.resultPanel.classList.remove('hidden');
  el.resultPanel.innerHTML = `<h3>本手结算</h3><p class="hint">${winners || '-'}</p><p class="hint">${side || '-'}</p>`;
}

function renderActions() {
  const actionState = roomState?.actionState;
  if (!actionState) {
    el.actionPanel.classList.add('hidden');
    return;
  }

  el.actionPanel.classList.remove('hidden');

  if (actionState.mode === 'straddle') {
    el.normalActionBox.classList.add('hidden');
    el.straddleBox.classList.remove('hidden');

    el.actionInfo.textContent = `你可以选择 straddle。最小到 ${actionState.minStraddleTo}，最大到 ${actionState.maxTo}`;
    el.straddleInput.min = String(actionState.minStraddleTo);
    el.straddleInput.max = String(actionState.maxTo);
    if (!el.straddleInput.value) el.straddleInput.value = String(actionState.defaultStraddleTo);

    el.straddleBtn.disabled = !actionState.canStraddle;
    el.skipStraddleBtn.disabled = !actionState.canSkipStraddle;
    return;
  }

  el.normalActionBox.classList.remove('hidden');
  el.straddleBox.classList.add('hidden');

  el.actionInfo.textContent = `需跟注 ${actionState.toCall} · 最小加注到 ${actionState.minRaiseTo} · 最大到 ${actionState.maxTo}`;

  el.foldBtn.disabled = false;
  el.checkBtn.disabled = !actionState.canCheck;
  el.callBtn.disabled = !actionState.canCall;
  el.allinBtn.disabled = actionState.maxTo <= 0;

  if (actionState.canBet) {
    el.betBtn.textContent = '下注到';
    el.betInput.min = String(actionState.minBetTo);
    if (!el.betInput.value) el.betInput.value = String(actionState.minBetTo);
  } else if (actionState.canRaise) {
    el.betBtn.textContent = '加注到';
    el.betInput.min = String(actionState.minRaiseTo);
    if (!el.betInput.value || Number(el.betInput.value) < actionState.minRaiseTo) {
      el.betInput.value = String(actionState.minRaiseTo);
    }
  } else {
    el.betBtn.textContent = '下注/加注';
  }

  el.betInput.max = String(actionState.maxTo);
  el.betBtn.disabled = !(actionState.canBet || actionState.canRaise);
}

function renderStatus() {
  const g = roomState?.game;
  const blind = roomState?.blindState || { smallBlind: roomState.settings.smallBlind, bigBlind: roomState.settings.bigBlind, level: 1 };

  el.roomTitle.textContent = roomState?.roomName || '房间';
  el.roomIdText.textContent = roomState?.roomId || '-';
  el.roomModeText.textContent = `${roomState?.settings?.mode || 'NLH'} · ${roomState?.myRole === 'spectator' ? '观战中' : '玩家'} · ${roomState?.settings?.tournamentMode ? '锦标赛' : '现金桌'}`;

  el.phaseText.textContent = g ? phaseLabel(g.phase) : '等待开局';
  el.potText.textContent = String(g?.potTotal || 0);
  el.betText.textContent = String(g?.currentBet || 0);
  el.turnText.textContent = roomMemberName(g?.turnId) || '-';

  el.dealerText.textContent = `庄家 ${roomMemberName(g?.dealerId)}`;
  el.sbText.textContent = `SB ${roomMemberName(g?.smallBlindId)}`;
  el.bbText.textContent = `BB ${roomMemberName(g?.bigBlindId)}`;
  el.blindText.textContent = `盲注 ${blind.smallBlind} / ${blind.bigBlind}`;
  el.blindLevelText.textContent = `级别 L${blind.level || 1}`;
  if (roomState.settings.tournamentMode && blind.nextLevelAt) {
    const left = Math.max(0, Math.ceil((blind.nextLevelAt - Date.now()) / 1000));
    el.nextBlindText.textContent = `下级别 ${fmtClock(left)}`;
  } else {
    el.nextBlindText.textContent = roomState.settings.tournamentMode ? '下级别 --:--' : '现金桌不涨盲';
  }

  const me = roomPlayerById(meId);
  el.readyBtn.textContent = me?.ready ? '取消准备' : '准备';

  const isHost = roomState.hostId === meId;
  const isPlayer = roomState.myRole === 'player';

  el.readyBtn.disabled = !isPlayer;
  el.startBtn.disabled = !(roomState.canStart && isHost && isPlayer);

  el.takeSeatBtn.classList.toggle('hidden', !roomState.canTakeSeat);
  el.becomeSpectatorBtn.classList.toggle('hidden', !roomState.canBecomeSpectator);

  const sessionSec = Math.max(0, Math.ceil((roomState.sessionEndsAt - Date.now()) / 1000));
  el.sessionTimer.textContent = `时长剩余 ${fmtClock(sessionSec)}`;

  const turnSec = g?.turnDeadlineAt ? Math.max(0, Math.ceil((g.turnDeadlineAt - Date.now()) / 1000)) : null;
  el.turnTimerText.textContent = turnSec === null ? '--' : `${turnSec}s`;

  const expiredText = roomState.sessionExpired ? '房间时长已到，不能再开始新手牌。' : '';
  showNotice(el.tableNotice, expiredText);

  const canEdit = isHost && (!roomState.game || roomState.game.finished);
  el.saveConfigBtn.disabled = !canEdit;

  if (!el.cfgRoomNameInput.dataset.init || canEdit) {
    el.cfgRoomNameInput.value = roomState.roomName || '';
    el.cfgPasswordInput.value = '';
    el.cfgStackInput.value = String(roomState.settings.startingStack);
    el.cfgSbInput.value = String(roomState.settings.smallBlind);
    el.cfgBbInput.value = String(roomState.settings.bigBlind);
    el.cfgMaxPlayersInput.value = String(roomState.settings.maxPlayers);
    el.cfgTurnInput.value = String(roomState.settings.turnTimeSec);
    el.cfgSessionInput.value = String(roomState.settings.sessionMinutes);
    el.cfgBlindIntervalInput.value = String(roomState.settings.blindIntervalMinutes || 15);
    el.cfgTournamentInput.checked = Boolean(roomState.settings.tournamentMode);
    el.cfgStraddleInput.checked = Boolean(roomState.settings.allowStraddle);
    el.cfgSpectatorInput.checked = Boolean(roomState.settings.allowSpectators);
    el.cfgRoomNameInput.dataset.init = '1';
  }
}

function renderLogs() {
  el.logs.textContent = (roomState?.logs || []).join('\n');
  el.logs.scrollTop = el.logs.scrollHeight;
}

function renderRoom() {
  if (!roomState) return;
  renderStatus();
  renderCommunity();
  renderSeatMap();
  renderSpectators();
  renderBanned();
  renderHistory();
  renderReplay();
  renderActions();
  renderResult();
  renderLogs();
}

function quickJoin(roomId, spectator, hasPassword) {
  if (!ensureConnected()) return;
  const name = ensureNickname();
  if (!name) {
    showNotice(el.notice, '需要先输入昵称');
    return;
  }
  let password = '';
  if (hasPassword) {
    const asked = window.prompt('请输入房间密码');
    if (asked === null) return;
    password = asked || '';
  }
  socket.emit('joinRoom', { roomId, name, password, spectator });
}

socket.on('lobbyRooms', (payload) => {
  lobbyState = payload || { rooms: [], serverNow: Date.now() };
  lastLobbyFetchAt = Date.now();
  renderLobbyRooms();
});

socket.on('connect', () => {
  socket.emit('listRooms');
  if (el.lobbyView.classList.contains('hidden')) {
    showNotice(el.tableNotice, '');
  } else {
    showNotice(el.notice, '');
  }
});

socket.on('disconnect', () => {
  if (el.lobbyView.classList.contains('hidden')) {
    showNotice(el.tableNotice, '连接已断开，正在尝试重连...');
  } else {
    showNotice(el.notice, '连接已断开，正在尝试重连...');
  }
});

socket.on('connect_error', () => {
  if (el.lobbyView.classList.contains('hidden')) {
    showNotice(el.tableNotice, '连接失败，请检查网络后重试');
  } else {
    showNotice(el.notice, '连接失败，请检查网络后重试');
  }
});

socket.on('joinedRoom', ({ playerId }) => {
  meId = playerId;
  replayState = null;
  el.lobbyView.classList.add('hidden');
  el.tableView.classList.remove('hidden');
  showNotice(el.notice, '');
  socket.emit('getHandHistory');
});

socket.on('roomState', (state) => {
  roomState = state;
  renderRoom();
});

socket.on('handHistoryData', ({ items }) => {
  if (!roomState) return;
  roomState.handHistory = items || [];
  renderHistory();
});

socket.on('handReplayData', (replay) => {
  replayState = replay || null;
  renderReplay();
});

socket.on('kicked', (payload) => {
  showNotice(el.notice, payload?.reason || '你已被移出房间');
  roomState = null;
  replayState = null;
  el.tableView.classList.add('hidden');
  el.lobbyView.classList.remove('hidden');
  socket.emit('listRooms');
});

socket.on('errorMessage', (msg) => {
  showNotice(el.tableView.classList.contains('hidden') ? el.notice : el.tableNotice, msg);
});

el.createBtn.addEventListener('click', () => {
  if (!ensureConnected()) return;
  const name = ensureNickname();
  if (!name) {
    showNotice(el.notice, '请输入昵称');
    return;
  }
  persistName();
  socket.emit('createRoom', { name, ...collectCreateSettings() });
});

el.joinBtn.addEventListener('click', () => {
  if (!ensureConnected()) return;
  const name = ensureNickname();
  if (!name) {
    showNotice(el.notice, '请输入昵称');
    return;
  }
  persistName();
  socket.emit('joinRoom', {
    roomId: el.joinRoomInput.value.trim().toUpperCase(),
    name,
    password: el.joinPasswordInput.value.trim(),
    spectator: el.joinSpectatorInput.checked,
  });
});

el.refreshLobbyBtn.addEventListener('click', () => {
  socket.emit('listRooms');
});

el.takeSeatBtn.addEventListener('click', () => socket.emit('takeSeat'));
el.becomeSpectatorBtn.addEventListener('click', () => socket.emit('becomeSpectator'));
el.readyBtn.addEventListener('click', () => socket.emit('toggleReady'));
el.startBtn.addEventListener('click', () => socket.emit('startHand'));

el.leaveBtn.addEventListener('click', () => {
  socket.emit('leaveRoom');
  roomState = null;
  replayState = null;
  el.tableView.classList.add('hidden');
  el.lobbyView.classList.remove('hidden');
  socket.emit('listRooms');
});

el.copyRoomBtn.addEventListener('click', async () => {
  if (!roomState?.roomId) return;
  const text = roomState.roomId;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else if (!fallbackCopy(text)) {
      throw new Error('copy-failed');
    }
    showNotice(el.tableNotice, '房间号已复制');
  } catch {
    const ok = fallbackCopy(text);
    if (ok) {
      showNotice(el.tableNotice, '房间号已复制');
      return;
    }
    window.prompt('复制房间号（手动复制）', text);
    showNotice(el.tableNotice, '当前浏览器限制复制，已弹出手动复制框');
  }
});

el.foldBtn.addEventListener('click', () => socket.emit('playerAction', { action: 'fold' }));
el.checkBtn.addEventListener('click', () => socket.emit('playerAction', { action: 'check' }));
el.callBtn.addEventListener('click', () => socket.emit('playerAction', { action: 'call' }));
el.allinBtn.addEventListener('click', () => socket.emit('playerAction', { action: 'allin' }));

el.betBtn.addEventListener('click', () => {
  const amount = parseNum(el.betInput.value, 0);
  if (!roomState?.actionState) return;
  const action = roomState.actionState.canBet ? 'bet' : 'raise';
  socket.emit('playerAction', { action, amount });
});

el.straddleBtn.addEventListener('click', () => {
  const amount = parseNum(el.straddleInput.value, 0);
  socket.emit('playerAction', { action: 'straddle', amount });
});

el.skipStraddleBtn.addEventListener('click', () => {
  socket.emit('playerAction', { action: 'skipstraddle' });
});

el.saveConfigBtn.addEventListener('click', () => {
  if (!roomState) return;
  socket.emit('updateRoomConfig', collectConfigSettings());
});

el.sendChatBtn.addEventListener('click', () => {
  const message = el.chatInput.value.trim();
  if (!message) return;
  socket.emit('chatMessage', { message });
  el.chatInput.value = '';
});

el.chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') el.sendChatBtn.click();
});

el.nameInput.addEventListener('change', persistName);

setInterval(() => {
  if (el.lobbyView.classList.contains('hidden')) {
    if (roomState) renderStatus();
  } else {
    if (Date.now() - lastLobbyFetchAt > 3000 && socket.connected) {
      socket.emit('listRooms');
      lastLobbyFetchAt = Date.now();
    }
    renderLobbyRooms();
  }
}, 1000);

window.addEventListener('resize', () => {
  if (roomState) renderRoom();
});

loadName();
(() => {
  const params = new URLSearchParams(window.location.search);
  const room = (params.get('room') || '').trim().toUpperCase();
  if (room) {
    el.joinRoomInput.value = room;
    showNotice(el.notice, `已填入邀请房间号：${room}`);
  }
})();
socket.emit('listRooms');
