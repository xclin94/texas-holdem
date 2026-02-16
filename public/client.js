const socket = io();

let lobbyState = { rooms: [], serverNow: Date.now() };
let roomState = null;
let meId = null;
let replayState = null;
let lastLobbyFetchAt = 0;
let joinPending = false;
let createPending = false;
let joinPendingTimer = null;
let createPendingTimer = null;
let actionPending = false;
let actionPendingTimer = null;
let uiSeatDensity = localStorage.getItem('holdem_seat_density') || 'auto';
let uiTheme = localStorage.getItem('holdem_theme') || 'forest';
let uiSoundEnabled = localStorage.getItem('holdem_sound') !== '0';
let uiSideCollapsed = localStorage.getItem('holdem_side_collapsed')
  ? localStorage.getItem('holdem_side_collapsed') === '1'
  : window.innerWidth <= 1080;
let uiActionPanelCollapsed = localStorage.getItem('holdem_action_collapsed')
  ? localStorage.getItem('holdem_action_collapsed') === '1'
  : window.innerWidth <= 760 || (window.innerWidth <= 960 && window.innerHeight <= 540);
let uiMotionMode = localStorage.getItem('holdem_motion_mode') || 'full';
let uiProfitFilter = localStorage.getItem('holdem_profit_filter') || 'all';
let bannerTimer = null;
let trackedHandNo = null;
let trackedPhase = null;
let trackedResultHandNo = null;
let trackedCommunityHandNo = null;
let trackedCommunityCount = 0;
let trackedSeatDealHandNo = null;
let trackedTurnCueToken = null;
let audioCtx = null;
let swipeStart = null;

const REQUEST_TIMEOUT_MS = 7000;
const ACTION_PENDING_MS = 1200;

const $ = (id) => document.getElementById(id);

const el = {
  lobbyView: $('lobbyView'),
  tableView: $('tableView'),
  notice: $('notice'),
  tableNotice: $('tableNotice'),

  nameInput: $('nameInput'),
  openCreatePanelBtn: $('openCreatePanelBtn'),
  openJoinPanelBtn: $('openJoinPanelBtn'),
  closeCreatePanelBtn: $('closeCreatePanelBtn'),
  closeJoinPanelBtn: $('closeJoinPanelBtn'),
  createPanel: $('createPanel'),
  joinPanel: $('joinPanel'),
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

  themeToggleBtn: $('themeToggleBtn'),
  soundToggleBtn: $('soundToggleBtn'),
  motionToggleBtn: $('motionToggleBtn'),
  sideToggleBtn: $('sideToggleBtn'),
  densityToggleBtn: $('densityToggleBtn'),
  focusMeBtn: $('focusMeBtn'),
  takeSeatBtn: $('takeSeatBtn'),
  becomeSpectatorBtn: $('becomeSpectatorBtn'),
  readyBtn: $('readyBtn'),
  startBtn: $('startBtn'),
  leaveBtn: $('leaveBtn'),

  phaseText: $('phaseText'),
  potText: $('potText'),
  potHeroText: $('potHeroText'),
  betText: $('betText'),
  betHeroText: $('betHeroText'),
  myStackText: $('myStackText'),
  turnText: $('turnText'),
  turnTimerText: $('turnTimerText'),
  dealerText: $('dealerText'),
  sbText: $('sbText'),
  bbText: $('bbText'),
  blindText: $('blindText'),
  blindLevelText: $('blindLevelText'),
  nextBlindText: $('nextBlindText'),

  communityCards: $('communityCards'),
  handBanner: $('handBanner'),
  tableGrid: $('tableGrid'),
  sidePanel: $('sidePanel'),
  tableCanvas: $('tableCanvas'),
  seatMap: $('seatMap'),
  spectatorsList: $('spectatorsList'),
  statsList: $('statsList'),
  profitChart: $('profitChart'),
  profitLegend: $('profitLegend'),
  profitFilterAllBtn: $('profitFilterAllBtn'),
  profitFilterMeBtn: $('profitFilterMeBtn'),
  bannedList: $('bannedList'),
  historyList: $('historyList'),
  replayBox: $('replayBox'),

  actionPanel: $('actionPanel'),
  actionPanelToggleBtn: $('actionPanelToggleBtn'),
  actionInfo: $('actionInfo'),
  actionMiniText: $('actionMiniText'),
  normalActionBox: $('normalActionBox'),
  quickRaiseBox: $('quickRaiseBox'),
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

const quickRaiseButtons = Array.from(document.querySelectorAll('.quick-raise-btn'));
const THEME_CYCLE = ['forest', 'ocean', 'sunset'];
const THEME_LABEL = {
  forest: '森林',
  ocean: '海洋',
  sunset: '日落',
};
const quickRaiseLabelMap = {
  '0.33': '1/3池',
  '0.5': '1/2池',
  '0.75': '3/4池',
  '1': '1池',
  '1.5': '1.5池',
  '2': '2池',
};
const MOBILE_SEAT_LAYOUTS = {
  2: [
    [50, 84],
    [50, 18],
  ],
  3: [
    [50, 85],
    [82, 40],
    [18, 40],
  ],
  4: [
    [50, 86],
    [84, 50],
    [50, 16],
    [16, 50],
  ],
  5: [
    [50, 87],
    [84, 62],
    [70, 24],
    [30, 24],
    [16, 62],
  ],
  6: [
    [50, 88],
    [86, 68],
    [86, 34],
    [50, 14],
    [14, 34],
    [14, 68],
  ],
  7: [
    [50, 89],
    [84, 74],
    [92, 46],
    [72, 21],
    [28, 21],
    [8, 46],
    [16, 74],
  ],
  8: [
    [50, 89],
    [82, 79],
    [94, 53],
    [79, 26],
    [50, 15],
    [21, 26],
    [6, 53],
    [18, 79],
  ],
  9: [
    [50, 89],
    [78, 81],
    [92, 63],
    [88, 38],
    [68, 20],
    [32, 20],
    [12, 38],
    [8, 63],
    [22, 81],
  ],
};
const NARROW_MOBILE_SEAT_LAYOUTS = {
  8: [
    [50, 89],
    [80, 79],
    [92, 54],
    [78, 29],
    [50, 17],
    [22, 29],
    [8, 54],
    [20, 79],
  ],
  9: [
    [50, 89],
    [78, 82],
    [92, 66],
    [90, 41],
    [68, 22],
    [32, 22],
    [10, 41],
    [8, 66],
    [22, 82],
  ],
};

function showNotice(target, msg, tone = 'info') {
  if (!msg) {
    target.classList.add('hidden');
    target.textContent = '';
    target.classList.remove('error', 'ok');
    return;
  }
  target.classList.remove('hidden');
  target.classList.remove('error', 'ok');
  if (tone === 'error') target.classList.add('error');
  if (tone === 'ok') target.classList.add('ok');
  target.textContent = msg;
}

function showHandBanner(message, tone = 'info', duration = 1600) {
  if (!el.handBanner) return;
  if (!message) {
    if (bannerTimer) {
      clearTimeout(bannerTimer);
      bannerTimer = null;
    }
    el.handBanner.classList.add('hidden');
    el.handBanner.classList.remove('error', 'ok');
    el.handBanner.textContent = '';
    return;
  }
  el.handBanner.classList.remove('hidden', 'error', 'ok');
  if (tone === 'error') el.handBanner.classList.add('error');
  if (tone === 'ok') el.handBanner.classList.add('ok');
  el.handBanner.textContent = message;
  if (bannerTimer) clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => {
    if (!el.handBanner) return;
    el.handBanner.classList.add('hidden');
  }, duration);
}

function refreshDensityButton() {
  if (!el.densityToggleBtn) return;
  el.densityToggleBtn.textContent = uiSeatDensity === 'compact' ? '标准视图' : '紧凑视图';
}

function applyTheme() {
  if (!THEME_CYCLE.includes(uiTheme)) uiTheme = 'forest';
  document.body.dataset.theme = uiTheme;
}

function refreshThemeButton() {
  if (!el.themeToggleBtn) return;
  el.themeToggleBtn.textContent = `主题：${THEME_LABEL[uiTheme] || '森林'}`;
}

function refreshSoundButton() {
  if (!el.soundToggleBtn) return;
  el.soundToggleBtn.textContent = `提示音：${uiSoundEnabled ? '开' : '关'}`;
}

function applyMotionMode() {
  if (uiMotionMode !== 'full' && uiMotionMode !== 'reduced') uiMotionMode = 'full';
  document.body.dataset.motion = uiMotionMode;
}

function refreshMotionButton() {
  if (!el.motionToggleBtn) return;
  el.motionToggleBtn.textContent = `动效：${uiMotionMode === 'reduced' ? '节能' : '标准'}`;
}

function refreshSideButton() {
  if (!el.sideToggleBtn) return;
  el.sideToggleBtn.textContent = uiSideCollapsed ? '展开边栏' : '收起边栏';
}

function refreshActionPanelToggleButton() {
  if (!el.actionPanelToggleBtn) return;
  el.actionPanelToggleBtn.textContent = uiActionPanelCollapsed ? '展开' : '收起';
}

function setSideCollapsed(next, persist = true) {
  uiSideCollapsed = Boolean(next);
  if (persist) {
    localStorage.setItem('holdem_side_collapsed', uiSideCollapsed ? '1' : '0');
  }
  applySideLayout();
}

function setActionPanelCollapsed(next, persist = true) {
  uiActionPanelCollapsed = Boolean(next);
  if (persist) {
    localStorage.setItem('holdem_action_collapsed', uiActionPanelCollapsed ? '1' : '0');
  }
  applyActionPanelCollapsed();
}

function applySideLayout() {
  if (!el.tableGrid || !el.sidePanel) return;
  el.tableGrid.classList.toggle('side-collapsed', uiSideCollapsed);
  el.sidePanel.classList.toggle('hidden', uiSideCollapsed);
  refreshSideButton();
}

function applyActionPanelCollapsed() {
  if (!el.actionPanel) return;
  el.actionPanel.classList.toggle('collapsed', uiActionPanelCollapsed);
  refreshActionPanelToggleButton();
}

function refreshProfitFilterButtons() {
  if (!el.profitFilterAllBtn || !el.profitFilterMeBtn) return;
  el.profitFilterAllBtn.classList.toggle('active', uiProfitFilter === 'all');
  el.profitFilterMeBtn.classList.toggle('active', uiProfitFilter === 'me');
}

function setProfitFilter(next) {
  uiProfitFilter = next === 'me' ? 'me' : 'all';
  localStorage.setItem('holdem_profit_filter', uiProfitFilter);
  refreshProfitFilterButtons();
  renderProfitChart();
}

function bindMobileSwipeControls() {
  if (!el.tableView) return;
  el.tableView.addEventListener(
    'touchstart',
    (evt) => {
      if (evt.touches.length !== 1) {
        swipeStart = null;
        return;
      }
      const raw = evt.target;
      const target = raw && raw.nodeType === 1 ? raw : raw?.parentElement;
      const ignore = Boolean(target && target.closest('button, input, textarea, select, a, .logs'));
      const t = evt.touches[0];
      swipeStart = {
        x: t.clientX,
        y: t.clientY,
        ts: Date.now(),
        ignore,
      };
    },
    { passive: true },
  );

  el.tableView.addEventListener(
    'touchend',
    (evt) => {
      if (!swipeStart || swipeStart.ignore || window.innerWidth > 1080) {
        swipeStart = null;
        return;
      }
      const elapsed = Date.now() - swipeStart.ts;
      const t = evt.changedTouches?.[0];
      if (!t || elapsed > 700) {
        swipeStart = null;
        return;
      }

      const dx = t.clientX - swipeStart.x;
      const dy = t.clientY - swipeStart.y;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      swipeStart = null;
      const actionVisible = !el.actionPanel.classList.contains('hidden');

      if (absX >= 70 && absY <= 45) {
        if (dx < 0 && !uiSideCollapsed) {
          setSideCollapsed(true, true);
          showHandBanner('已收起边栏', 'info', 700);
        } else if (dx > 0 && uiSideCollapsed) {
          setSideCollapsed(false, true);
          showHandBanner('已展开边栏', 'ok', 700);
        }
        return;
      }

      if (absY >= 70 && absX <= 45 && actionVisible) {
        if (dy > 0 && !uiActionPanelCollapsed) {
          setActionPanelCollapsed(true, true);
          showHandBanner('已收起操作区', 'info', 700);
        } else if (dy < 0 && uiActionPanelCollapsed) {
          setActionPanelCollapsed(false, true);
          showHandBanner('已展开操作区', 'ok', 700);
        }
      }
    },
    { passive: true },
  );
}

function playTurnCue() {
  if (!uiSoundEnabled) return;
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return;
  try {
    if (!audioCtx || audioCtx.state === 'closed') {
      audioCtx = new AudioCtor();
    }
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(820, now);
    osc.frequency.exponentialRampToValueAtTime(520, now + 0.14);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.17);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.18);
    if (navigator.vibrate) navigator.vibrate(90);
  } catch {
    // Ignore autoplay/device limitations.
  }
}

function setActionPending(v) {
  actionPending = Boolean(v);
  if (actionPendingTimer) {
    clearTimeout(actionPendingTimer);
    actionPendingTimer = null;
  }
  if (actionPending) {
    actionPendingTimer = setTimeout(() => {
      actionPending = false;
      if (roomState) renderActions();
    }, ACTION_PENDING_MS);
  }
}

function sendPlayerAction(payload) {
  if (!payload || typeof payload !== 'object') return;
  if (actionPending) return;
  setActionPending(true);
  socket.emit('playerAction', payload);
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

function clampInt(v, min, max) {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

function ensureConnected() {
  if (socket.connected) return true;
  showNotice(el.notice, '网络连接中，请稍后再试', 'error');
  socket.connect();
  return false;
}

function ensureNickname() {
  return el.nameInput.value.trim();
}

function closeLobbyPanels() {
  el.createPanel.classList.add('hidden');
  el.joinPanel.classList.add('hidden');
}

function openCreatePanel() {
  el.joinPanel.classList.add('hidden');
  el.createPanel.classList.remove('hidden');
}

function openJoinPanel() {
  el.createPanel.classList.add('hidden');
  el.joinPanel.classList.remove('hidden');
}

function refreshPendingButtons() {
  el.joinBtn.disabled = joinPending;
  el.createBtn.disabled = createPending;
  el.joinBtn.textContent = joinPending ? '加入中...' : '确认加入';
  el.createBtn.textContent = createPending ? '创建中...' : '确认创建';
}

function clearJoinPending() {
  joinPending = false;
  if (joinPendingTimer) {
    clearTimeout(joinPendingTimer);
    joinPendingTimer = null;
  }
  refreshPendingButtons();
}

function clearCreatePending() {
  createPending = false;
  if (createPendingTimer) {
    clearTimeout(createPendingTimer);
    createPendingTimer = null;
  }
  refreshPendingButtons();
}

function clearAllPending() {
  clearJoinPending();
  clearCreatePending();
}

function startJoinPending(roomId) {
  clearJoinPending();
  joinPending = true;
  refreshPendingButtons();
  joinPendingTimer = setTimeout(() => {
    if (!joinPending) return;
    clearJoinPending();
    showNotice(el.notice, `加入房间超时：${roomId || '-'}，请检查房间号/密码/网络后重试`, 'error');
  }, REQUEST_TIMEOUT_MS);
}

function startCreatePending() {
  clearCreatePending();
  createPending = true;
  refreshPendingButtons();
  createPendingTimer = setTimeout(() => {
    if (!createPending) return;
    clearCreatePending();
    showNotice(el.notice, '创建房间超时，请检查网络后重试', 'error');
  }, REQUEST_TIMEOUT_MS);
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

function cardNode(code, hidden = false, extraClass = '') {
  const node = document.createElement('div');
  node.className = `card-face${hidden ? ' back' : ''}${extraClass ? ` ${extraClass}` : ''}`;
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
  const handNo = roomState?.game?.handNo || null;
  if (handNo !== trackedCommunityHandNo) {
    trackedCommunityHandNo = handNo;
    trackedCommunityCount = 0;
  }
  cards.forEach((c, idx) => {
    const isNew = idx >= trackedCommunityCount;
    el.communityCards.appendChild(cardNode(c, false, isNew ? 'deal-in' : ''));
  });
  trackedCommunityCount = cards.length;
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
  return window.innerWidth <= 760 || isLandscapePhoneView();
}

function isLandscapePhoneView() {
  return window.innerWidth <= 960 && window.innerHeight <= 540;
}

function isNarrowMobileView() {
  return window.innerWidth <= 420 || (isLandscapePhoneView() && window.innerHeight <= 430);
}

function compactStackText(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  if (n >= 1000000) return `${(n / 1000000).toFixed(n >= 10000000 ? 0 : 1)}m`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(Math.max(0, Math.floor(n)));
}

function getSeatLayout(maxPlayers, compact) {
  const count = clampInt(maxPlayers, 2, 9);
  if (compact && isNarrowMobileView() && NARROW_MOBILE_SEAT_LAYOUTS[count]) {
    return NARROW_MOBILE_SEAT_LAYOUTS[count].map((p) => [p[0], p[1]]);
  }
  if (compact && MOBILE_SEAT_LAYOUTS[count]) {
    return MOBILE_SEAT_LAYOUTS[count].map((p) => [p[0], p[1]]);
  }

  const radiusX = compact ? (count >= 8 ? 44 : 42) : count >= 8 ? 44 : 42;
  const radiusY = compact ? (count >= 8 ? 40 : 38) : count >= 8 ? 42 : 40;
  const startDeg = 90;
  const step = 360 / count;
  const points = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (startDeg - i * step) * (Math.PI / 180);
    points.push([50 + radiusX * Math.cos(angle), 50 + radiusY * Math.sin(angle)]);
  }
  return points;
}

function seatNodePreset(maxPlayers, compact) {
  const n = clampInt(maxPlayers, 2, 9);
  const forceCompact = uiSeatDensity === 'compact';
  const narrowMobile = compact && isNarrowMobileView();
  if (compact) {
    let base;
    if (forceCompact) base = { width: 72, height: 54, compact: true, dense: true };
    else if (n >= 9) base = { width: 72, height: 54, compact: true, dense: true };
    else if (n >= 8) base = { width: 76, height: 56, compact: true, dense: true };
    else if (n >= 7) base = { width: 82, height: 60, compact: true, dense: true };
    else if (n >= 6) base = { width: 88, height: 62, compact: true, dense: false };
    else base = { width: 100, height: 70, compact: true, dense: false };

    if (!narrowMobile) return base;
    return {
      ...base,
      width: Math.max(64, base.width - 8),
      height: Math.max(48, base.height - 6),
      dense: true,
    };
  }
  if (forceCompact) return { width: 118, height: 84, compact: false, dense: true };
  if (n >= 8) return { width: 124, height: 88, compact: false, dense: true };
  if (n >= 6) return { width: 148, height: 100, compact: false, dense: false };
  return { width: 170, height: 116, compact: false, dense: false };
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
  const handNo = roomState?.game?.handNo || null;
  const compact = isMobileView();
  const narrowMobile = compact && isNarrowMobileView();
  const layout = getSeatLayout(maxPlayers, compact);
  const posMap = buildPositionLabelMap();
  const preset = seatNodePreset(maxPlayers, compact);
  const shouldAnimateSeatDeal = Boolean(handNo && handNo !== trackedSeatDealHandNo);

  if (el.tableCanvas) {
    const minHeight = compact
      ? maxPlayers >= 8
        ? narrowMobile
          ? 800
          : 760
        : 640
      : maxPlayers >= 8
        ? 800
        : 700;
    el.tableCanvas.style.minHeight = `${minHeight}px`;
  }

  for (let seat = 1; seat <= maxPlayers; seat += 1) {
    const point = layout[seat - 1] || [50, 50];
    const p = players.find((x) => x.seat === seat);
    const isTurn = Boolean(p && roomState?.game?.turnId === p.id && !roomState?.game?.finished);

    const node = document.createElement('div');
    node.className = `seat-node${p ? '' : ' empty'}${p?.id === meId ? ' me' : ''}${isTurn ? ' turn' : ''}${preset.compact ? ' compact' : ''}${preset.dense ? ' dense' : ''}`;
    const emptyMinWidth = narrowMobile ? 56 : 68;
    const emptyMinHeight = narrowMobile ? 30 : 34;
    node.style.left = `${point[0]}%`;
    node.style.top = `${point[1]}%`;
    node.style.width = `${p ? preset.width : Math.max(emptyMinWidth, Math.floor(preset.width * 0.66))}px`;
    node.style.minHeight = `${p ? preset.height : Math.max(emptyMinHeight, Math.floor(preset.height * 0.5))}px`;
    node.style.zIndex = String((p?.id === meId ? 40 : 20) + Math.floor(point[1] / 10));

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
    const badgeLimit = compact ? 3 : 99;
    const pushBadge = (text, klass = '') => {
      if (badges.childElementCount >= badgeLimit) return;
      addBadge(badges, text, klass);
    };
    if (compact) pushBadge(pos, 'gold');
    if (p.id === roomState.hostId) pushBadge(compact ? '房' : '房主', 'gold');
    if (roomState.game?.turnId === p.id && !roomState.game?.finished) pushBadge(compact ? '行动' : '行动中', 'ok');
    if (!compact && p.ready) pushBadge('已准备', 'ok');
    if (p.folded) pushBadge(compact ? '弃' : '弃牌', 'warn');
    if (p.allIn) pushBadge('全下');
    if (!p.connected) pushBadge('离线', 'warn');

    const sub = document.createElement('div');
    sub.className = 'seat-sub';
    if (compact) {
      const stackText = compactStackText(p.stack);
      const action = !narrowMobile && p.lastAction ? ` · ${p.lastAction}` : '';
      sub.textContent = `后手 ${stackText}${action}`;
    } else {
      sub.textContent = `后手 ${p.stack} · 本轮 ${p.betThisStreet} · 总投入 ${p.totalContribution}`;
    }

    const act = !compact ? document.createElement('div') : null;
    if (act) {
      act.className = 'seat-sub';
      act.textContent = p.lastAction || '等待中';
    }

    const cards = document.createElement('div');
    cards.className = 'seat-cards';
    const showCompactCards = !compact || p.id === meId || roomState.game?.finished;
    if (p.holeCards?.length && showCompactCards) {
      p.holeCards.forEach((c, idx) => {
        const card = cardNode(c, false, shouldAnimateSeatDeal ? 'deal-seat' : '');
        if (shouldAnimateSeatDeal) {
          card.style.animationDelay = `${(seat - 1) * 45 + idx * 60}ms`;
        }
        cards.appendChild(card);
      });
    } else if (!compact && p.inHand && !roomState.game?.finished) {
      cards.appendChild(cardNode('XX', true));
      cards.appendChild(cardNode('XX', true));
    }

    node.appendChild(head);
    node.appendChild(badges);
    node.appendChild(sub);
    if (act) node.appendChild(act);
    if (cards.children.length > 0) {
      node.appendChild(cards);
    }

    const admin = createAdminButtons(p.id);
    if (admin) node.appendChild(admin);

    el.seatMap.appendChild(node);
  }

  if (shouldAnimateSeatDeal) {
    trackedSeatDealHandNo = handNo;
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

function renderStats() {
  el.statsList.innerHTML = '';
  const players = roomState?.players || [];
  if (!players.length) {
    el.statsList.textContent = '暂无入座玩家';
    return;
  }

  const base = Math.max(1, roomState?.settings?.startingStack || 1);
  const rows = players
    .map((p) => ({
      id: p.id,
      name: p.name,
      stack: p.stack,
      net: p.stack - base,
    }))
    .sort((a, b) => b.net - a.net);
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.net)));

  const summary = document.createElement('div');
  summary.className = 'stats-summary';
  summary.textContent = `已完成 ${roomState?.handHistory?.length || 0} 手`;
  el.statsList.appendChild(summary);

  rows.forEach((r) => {
    const row = document.createElement('div');
    row.className = `stat-row${r.id === meId ? ' me' : ''}`;

    const top = document.createElement('div');
    top.className = 'stat-top';
    const name = document.createElement('span');
    name.textContent = r.name;
    const net = document.createElement('span');
    net.className = r.net > 0 ? 'pos' : r.net < 0 ? 'neg' : 'zero';
    net.textContent = `${r.net > 0 ? '+' : ''}${r.net}`;
    top.appendChild(name);
    top.appendChild(net);

    const bar = document.createElement('div');
    bar.className = 'stat-bar';
    const fill = document.createElement('div');
    fill.className = `fill ${r.net > 0 ? 'pos' : r.net < 0 ? 'neg' : 'zero'}`;
    fill.style.width = `${Math.max(6, Math.round((Math.abs(r.net) / maxAbs) * 100))}%`;
    bar.appendChild(fill);

    const sub = document.createElement('div');
    sub.className = 'stat-sub';
    sub.textContent = `后手 ${r.stack}`;

    row.appendChild(top);
    row.appendChild(bar);
    row.appendChild(sub);
    el.statsList.appendChild(row);
  });
}

function colorForSeries(i) {
  const palette = ['#f7c873', '#7fd5ff', '#9ef5bf', '#ffb8ca', '#d8c9ff', '#ffdf94', '#7ce4d2', '#ff9f7f', '#a0b3ff'];
  return palette[i % palette.length];
}

function renderProfitChart() {
  if (!el.profitChart || !el.profitLegend) return;
  refreshProfitFilterButtons();
  const history = [...(roomState?.handHistory || [])].reverse();
  el.profitChart.innerHTML = '';
  el.profitLegend.innerHTML = '';

  if (!history.length) {
    el.profitLegend.textContent = '暂无可视化战绩';
    return;
  }

  const hasStacks = history.some((h) => Array.isArray(h.stacksAfter) && h.stacksAfter.length);
  if (!hasStacks) {
    el.profitLegend.textContent = '新版本开始的手牌会显示净值曲线';
    return;
  }

  const start = roomState?.settings?.startingStack || 0;
  const xMin = 18;
  const xMax = 348;
  const yMin = 14;
  const yMax = 150;

  const seriesMap = new Map();
  history.forEach((hand) => {
    const items = hand.stacksAfter || [];
    items.forEach((p) => {
      if (!seriesMap.has(p.playerId)) {
        seriesMap.set(p.playerId, {
          playerId: p.playerId,
          name: p.name || roomMemberName(p.playerId),
          points: [],
        });
      }
      seriesMap.get(p.playerId).points.push({
        handNo: hand.handNo,
        net: (p.stackAfter || 0) - start,
      });
    });
  });

  const fullSeries = [...seriesMap.values()].filter((s) => s.points.length >= 2);
  if (!fullSeries.length) {
    el.profitLegend.textContent = '至少两手历史后显示曲线';
    return;
  }
  const series = uiProfitFilter === 'me' ? fullSeries.filter((s) => s.playerId === meId) : fullSeries;
  if (!series.length) {
    el.profitLegend.textContent = '暂无你的净值曲线';
    return;
  }

  let minNet = 0;
  let maxNet = 0;
  const allHands = history.map((h) => h.handNo);
  const firstHand = Math.min(...allHands);
  const lastHand = Math.max(...allHands);
  series.forEach((s) => {
    s.points.forEach((p) => {
      minNet = Math.min(minNet, p.net);
      maxNet = Math.max(maxNet, p.net);
    });
  });

  if (minNet === maxNet) {
    minNet -= 1;
    maxNet += 1;
  }

  const axisY = ((0 - minNet) / (maxNet - minNet)) * (yMax - yMin) + yMin;
  const safeAxisY = Math.max(yMin, Math.min(yMax, axisY));
  const axis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  axis.setAttribute('x1', String(xMin));
  axis.setAttribute('x2', String(xMax));
  axis.setAttribute('y1', String(safeAxisY));
  axis.setAttribute('y2', String(safeAxisY));
  axis.setAttribute('class', 'profit-axis');
  el.profitChart.appendChild(axis);

  const divisor = Math.max(1, lastHand - firstHand);
  const scaleX = (handNo) => xMin + ((handNo - firstHand) / divisor) * (xMax - xMin);
  const scaleY = (net) => yMax - ((net - minNet) / (maxNet - minNet)) * (yMax - yMin);

  series.forEach((s, idx) => {
    const color = colorForSeries(idx);
    const pts = s.points
      .map((p) => `${scaleX(p.handNo).toFixed(2)},${scaleY(p.net).toFixed(2)}`)
      .join(' ');
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    line.setAttribute('points', pts);
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', s.playerId === meId ? '3' : '2');
    line.setAttribute('class', 'profit-line');
    el.profitChart.appendChild(line);

    const last = s.points[s.points.length - 1];
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', String(scaleX(last.handNo)));
    dot.setAttribute('cy', String(scaleY(last.net)));
    dot.setAttribute('r', s.playerId === meId ? '4' : '3');
    dot.setAttribute('fill', color);
    dot.setAttribute('class', 'profit-dot');
    el.profitChart.appendChild(dot);

    const legend = document.createElement('div');
    legend.className = `legend-item${s.playerId === meId ? ' me' : ''}`;
    legend.innerHTML = `<span class="swatch" style="background:${color}"></span><span class="name">${s.name}</span><span class="val">${last.net > 0 ? '+' : ''}${last.net}</span>`;
    el.profitLegend.appendChild(legend);
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
  const game = roomState?.game;
  const result = game?.result;
  if (!game?.finished && !result) {
    el.resultPanel.classList.add('hidden');
    el.resultPanel.innerHTML = '';
    return;
  }

  const winners = result?.winners || [];
  const winnerHtml = winners.length
    ? winners
        .map((w) => {
          const name = w.name || roomMemberName(w.playerId);
          return `<div class="result-winner"><span class="who">${name}</span><span class="gain">+${w.amount}</span><span class="hand">${w.hand || ''}</span></div>`;
        })
        .join('')
    : '<div class="hint">本手无赢家信息</div>';
  const side = (result?.sidePots || [])
    .map((p, idx) => `边池${idx + 1}: ${p.amount} -> ${(p.winners || []).map((id) => roomMemberName(id)).join('/')} ${p.handName ? `(${p.handName})` : ''}`)
    .join('<br/>');
  const canContinue = Boolean(roomState?.canStart);
  const autoStartSec = roomState?.autoStartAt ? Math.max(0, Math.ceil((roomState.autoStartAt - Date.now()) / 1000)) : 0;
  const autoStartDelayMs = Math.max(800, Number(roomState?.autoStartDelayMs || 2200));
  const autoStartRemainMs = roomState?.autoStartAt ? Math.max(0, roomState.autoStartAt - Date.now()) : 0;
  const autoStartPct = Math.max(0, Math.min(100, Math.round((autoStartRemainMs / autoStartDelayMs) * 100)));
  const iAmHost = roomState?.hostId === meId;
  const cta = autoStartSec > 0
    ? `<div class="auto-next"><p class="hint">下一手将在 ${autoStartSec}s 后自动开始</p><div class="auto-next-bar"><i style="width:${autoStartPct}%"></i></div></div>`
    : canContinue
      ? iAmHost
        ? '<button id="nextHandBtn" class="btn primary">立即开始下一手</button>'
        : '<p class="hint">等待房主开始下一手</p>'
      : '<p class="hint">至少需要 2 名已准备玩家才能继续</p>';
  el.resultPanel.classList.remove('hidden');
  el.resultPanel.innerHTML = `<h3>本手结算</h3><div class="result-winners">${winnerHtml}</div><p class="hint">${side || '本手无边池分配'}</p><div class="result-cta">${cta}</div>`;
  const nextHandBtn = $('nextHandBtn');
  if (nextHandBtn) {
    nextHandBtn.onclick = () => socket.emit('startHand');
  }
}

function calcQuickRaiseTarget(actionState, ratio) {
  if (!roomState?.game || !actionState) return null;
  if (!(actionState.canBet || actionState.canRaise)) return null;
  if (!Number.isFinite(ratio) || ratio <= 0) return null;

  const pot = Math.max(0, roomState.game.potTotal || 0);
  const currentBet = Math.max(0, roomState.game.currentBet || 0);
  let target;

  if (actionState.canBet) {
    const byPot = Math.floor(pot * ratio);
    target = Math.max(actionState.minBetTo, byPot || actionState.minBetTo);
  } else {
    const raiseBy = Math.max(1, Math.floor(pot * ratio));
    target = Math.max(actionState.minRaiseTo, currentBet + raiseBy);
  }

  target = clampInt(target, 0, actionState.maxTo);
  if (actionState.canRaise && target <= currentBet) return null;
  return target;
}

function renderQuickRaiseButtons(actionState) {
  const canQuick = Boolean(actionState && (actionState.canBet || actionState.canRaise));
  el.quickRaiseBox.classList.toggle('hidden', !canQuick);
  if (!canQuick) return;

  quickRaiseButtons.forEach((btn) => {
    const ratioKey = btn.dataset.potRatio || '';
    const ratio = Number(ratioKey);
    const label = quickRaiseLabelMap[ratioKey] || `${ratioKey}池`;
    const target = calcQuickRaiseTarget(actionState, ratio);

    if (!Number.isFinite(target) || target <= 0) {
      btn.disabled = true;
      btn.textContent = label;
      btn.dataset.target = '';
      btn.classList.remove('active');
      return;
    }

    btn.disabled = actionPending;
    btn.textContent = `${label} ${target}`;
    btn.dataset.target = String(target);
  });
  syncQuickRaiseActive();
}

function syncQuickRaiseActive() {
  const current = parseNum(el.betInput.value, 0);
  quickRaiseButtons.forEach((btn) => {
    const target = parseNum(btn.dataset.target, 0);
    btn.classList.toggle('active', target > 0 && target === current);
  });
}

function renderActions() {
  const actionState = roomState?.actionState;
  if (!actionState) {
    setActionPending(false);
    el.actionPanel.classList.add('hidden');
    el.actionMiniText.classList.add('hidden');
    return;
  }

  const cueToken = `${roomState?.game?.handNo || 0}-${roomState?.game?.phase || ''}-${roomState?.game?.turnId || ''}-${actionState.mode}`;
  if (cueToken !== trackedTurnCueToken) {
    trackedTurnCueToken = cueToken;
    if (isMobileView() && uiActionPanelCollapsed) {
      setActionPanelCollapsed(false, false);
    }
    showHandBanner('轮到你行动', 'ok', 1000);
    playTurnCue();
  }

  el.actionPanel.classList.remove('hidden');
  applyActionPanelCollapsed();

  if (actionState.mode === 'straddle') {
    el.normalActionBox.classList.add('hidden');
    el.straddleBox.classList.remove('hidden');
    el.quickRaiseBox.classList.add('hidden');

    el.actionInfo.textContent = `你可以选择 straddle。最小到 ${actionState.minStraddleTo}，最大到 ${actionState.maxTo}`;
    el.straddleInput.min = String(actionState.minStraddleTo);
    el.straddleInput.max = String(actionState.maxTo);
    if (!el.straddleInput.value) el.straddleInput.value = String(actionState.defaultStraddleTo);
    el.actionMiniText.textContent = `straddle ${actionState.minStraddleTo}-${actionState.maxTo}`;
    el.actionMiniText.classList.toggle('hidden', !uiActionPanelCollapsed);

    el.straddleBtn.disabled = !actionState.canStraddle || actionPending;
    el.skipStraddleBtn.disabled = !actionState.canSkipStraddle || actionPending;
    return;
  }

  el.normalActionBox.classList.remove('hidden');
  el.straddleBox.classList.add('hidden');

  el.actionInfo.textContent = `需跟注 ${actionState.toCall} · 最小加注到 ${actionState.minRaiseTo} · 最大到 ${actionState.maxTo}`;
  el.actionMiniText.textContent = `跟 ${actionState.toCall} / 最小 ${actionState.minRaiseTo}`;
  el.actionMiniText.classList.toggle('hidden', !uiActionPanelCollapsed);

  el.foldBtn.disabled = actionPending;
  el.checkBtn.disabled = !actionState.canCheck || actionPending;
  el.callBtn.disabled = !actionState.canCall || actionPending;
  el.allinBtn.disabled = actionState.maxTo <= 0 || actionPending;

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
  el.betBtn.disabled = !(actionState.canBet || actionState.canRaise) || actionPending;
  renderQuickRaiseButtons(actionState);
}

function renderStatus() {
  const g = roomState?.game;
  const blind = roomState?.blindState || { smallBlind: roomState.settings.smallBlind, bigBlind: roomState.settings.bigBlind, level: 1 };
  if (!g) {
    trackedHandNo = null;
    trackedPhase = null;
    trackedResultHandNo = null;
    trackedSeatDealHandNo = null;
    trackedTurnCueToken = null;
  } else {
    if (trackedHandNo !== g.handNo) {
      trackedHandNo = g.handNo;
      trackedPhase = g.phase;
      trackedTurnCueToken = null;
      showHandBanner(`第 ${g.handNo} 手牌开始`, 'ok', 1300);
    } else if (!g.finished && trackedPhase !== g.phase) {
      trackedPhase = g.phase;
      showHandBanner(phaseLabel(g.phase), 'info', 1000);
    }
    if (g.finished && trackedResultHandNo !== g.handNo) {
      trackedResultHandNo = g.handNo;
      const firstWinner = g.result?.winners?.[0];
      showHandBanner(firstWinner ? `${firstWinner.name || roomMemberName(firstWinner.playerId)} 赢下本手` : '本手结束', 'ok', 2100);
    }
  }

  el.roomTitle.textContent = roomState?.roomName || '房间';
  el.roomIdText.textContent = roomState?.roomId || '-';
  el.roomModeText.textContent = `${roomState?.settings?.mode || 'NLH'} · ${roomState?.myRole === 'spectator' ? '观战中' : '玩家'} · ${roomState?.settings?.tournamentMode ? '锦标赛' : '现金桌'}`;

  const autoStartSec = roomState?.autoStartAt ? Math.max(0, Math.ceil((roomState.autoStartAt - Date.now()) / 1000)) : 0;
  if (g?.finished && autoStartSec > 0) {
    el.phaseText.textContent = `本手结束 · ${autoStartSec}s后自动下一手`;
  } else {
    el.phaseText.textContent = g ? phaseLabel(g.phase) : '等待开局';
  }
  const potTotal = g?.potTotal || 0;
  const currentBet = g?.currentBet || 0;
  el.potText.textContent = String(potTotal);
  el.potHeroText.textContent = String(potTotal);
  el.betText.textContent = String(currentBet);
  el.betHeroText.textContent = String(currentBet);
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
  el.myStackText.textContent = me ? String(me.stack) : '-';
  el.readyBtn.textContent = me?.ready ? '取消准备' : '准备';

  const isHost = roomState.hostId === meId;
  const isPlayer = roomState.myRole === 'player';

  el.readyBtn.disabled = !isPlayer;
  const waitingAuto = Boolean(g?.finished && autoStartSec > 0);
  el.startBtn.disabled = waitingAuto || !(roomState.canStart && isHost && isPlayer);
  if (waitingAuto) {
    el.startBtn.textContent = `自动发牌 ${autoStartSec}s`;
  } else {
    el.startBtn.textContent = g?.finished ? '开始下一手' : '房主开局';
  }

  el.takeSeatBtn.classList.toggle('hidden', !roomState.canTakeSeat);
  el.becomeSpectatorBtn.classList.toggle('hidden', !roomState.canBecomeSpectator);

  const sessionSec = Math.max(0, Math.ceil((roomState.sessionEndsAt - Date.now()) / 1000));
  el.sessionTimer.textContent = `时长剩余 ${fmtClock(sessionSec)}`;

  const turnSec = g?.turnDeadlineAt ? Math.max(0, Math.ceil((g.turnDeadlineAt - Date.now()) / 1000)) : null;
  el.turnTimerText.textContent = turnSec === null ? '--' : `${turnSec}s`;

  let tableTip = '';
  let tipTone = 'info';
  if (roomState.sessionExpired) {
    tableTip = '房间时长已到，不能再开始新手牌。';
    tipTone = 'error';
  } else if (g?.finished) {
    if (autoStartSec > 0) {
      tableTip = `本手结束，${autoStartSec}s 后自动开始下一手。`;
      tipTone = 'ok';
    } else if (roomState.canStart) {
      tableTip = isHost ? '本手结束，可立即开始下一手。' : '本手结束，等待房主开始下一手。';
      tipTone = 'ok';
    } else {
      tableTip = '本手结束，至少 2 名已准备玩家才能继续。';
      tipTone = 'error';
    }
  }
  showNotice(el.tableNotice, tableTip, tipTone);

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

function myDisplayName() {
  return roomPlayerById(meId)?.name || roomState?.spectators?.find((s) => s.id === meId)?.name || '';
}

function parseLogLine(rawLine) {
  const line = String(rawLine || '');
  const tm = line.match(/^(\d{1,2}:\d{2}:\d{2})\s(.+)$/);
  const timeText = tm ? tm[1] : '';
  const body = tm ? tm[2] : line;
  const chat = body.match(/^([^:：]{1,24}?)(\(观战\))?[:：]\s(.+)$/);
  if (!chat) {
    return {
      kind: 'system',
      timeText,
      text: body,
    };
  }
  return {
    kind: 'chat',
    timeText,
    sender: chat[1].trim(),
    spectatorTag: chat[2] ? '(观战)' : '',
    message: chat[3],
  };
}

function renderLogs() {
  const lines = roomState?.logs || [];
  const me = myDisplayName();
  const nearBottom = el.logs.scrollHeight - el.logs.scrollTop - el.logs.clientHeight < 28;
  el.logs.innerHTML = '';

  lines.forEach((line) => {
    const parsed = parseLogLine(line);
    const item = document.createElement('div');
    item.className = `log-item ${parsed.kind}`;

    if (parsed.kind === 'chat') {
      const mine = parsed.sender === me;
      if (mine) item.classList.add('mine');

      const meta = document.createElement('div');
      meta.className = 'log-meta';
      meta.textContent = `${parsed.sender}${parsed.spectatorTag || ''}${parsed.timeText ? ` · ${parsed.timeText}` : ''}`;

      const bubble = document.createElement('div');
      bubble.className = 'log-bubble';
      bubble.textContent = parsed.message || '';

      item.appendChild(meta);
      item.appendChild(bubble);
    } else {
      const sys = document.createElement('div');
      sys.className = 'log-system';
      sys.textContent = `${parsed.timeText ? `${parsed.timeText} ` : ''}${parsed.text || ''}`;
      item.appendChild(sys);
    }

    el.logs.appendChild(item);
  });

  if (nearBottom) {
    el.logs.scrollTop = el.logs.scrollHeight;
  }
}

function renderRoom() {
  if (!roomState) return;
  renderStatus();
  renderCommunity();
  renderSeatMap();
  renderSpectators();
  renderStats();
  renderBanned();
  renderHistory();
  renderReplay();
  renderActions();
  renderResult();
  renderLogs();
  renderProfitChart();
}

function emitJoinRequest({ roomId, name, password, spectator }) {
  if (joinPending) {
    showNotice(el.notice, '正在加入房间，请稍候', 'error');
    return;
  }
  startJoinPending(roomId);
  socket.emit('joinRoom', { roomId, name, password, spectator });
}

function quickJoin(roomId, spectator, hasPassword) {
  if (!ensureConnected()) return;
  const name = ensureNickname();
  if (!name) {
    showNotice(el.notice, '请先输入昵称再加入', 'error');
    el.nameInput.focus();
    return;
  }
  persistName();

  const normalizedRoomId = String(roomId || '').toUpperCase().trim();
  if (!normalizedRoomId) {
    showNotice(el.notice, '房间号无效', 'error');
    return;
  }

  if (hasPassword) {
    el.joinRoomInput.value = normalizedRoomId;
    el.joinSpectatorInput.checked = Boolean(spectator);
    openJoinPanel();
    showNotice(el.notice, '该房间需要密码，请填写后点击确认加入', 'error');
    el.joinPasswordInput.focus();
    return;
  }

  emitJoinRequest({
    roomId: normalizedRoomId,
    name,
    password: '',
    spectator: Boolean(spectator),
  });
}

socket.on('lobbyRooms', (payload) => {
  lobbyState = payload || { rooms: [], serverNow: Date.now() };
  lastLobbyFetchAt = Date.now();
  renderLobbyRooms();
});

socket.on('connect', () => {
  clearAllPending();
  socket.emit('listRooms');
  if (el.lobbyView.classList.contains('hidden')) {
    showNotice(el.tableNotice, '');
  } else {
    showNotice(el.notice, '');
  }
});

socket.on('disconnect', () => {
  clearAllPending();
  setActionPending(false);
  if (el.lobbyView.classList.contains('hidden')) {
    showNotice(el.tableNotice, '连接已断开，正在尝试重连...', 'error');
  } else {
    showNotice(el.notice, '连接已断开，正在尝试重连...', 'error');
  }
});

socket.on('connect_error', () => {
  clearAllPending();
  setActionPending(false);
  if (el.lobbyView.classList.contains('hidden')) {
    showNotice(el.tableNotice, '连接失败，请检查网络后重试', 'error');
  } else {
    showNotice(el.notice, '连接失败，请检查网络后重试', 'error');
  }
});

socket.on('joinedRoom', ({ playerId }) => {
  clearAllPending();
  setActionPending(false);
  trackedHandNo = null;
  trackedPhase = null;
  trackedResultHandNo = null;
  trackedCommunityHandNo = null;
  trackedCommunityCount = 0;
  trackedSeatDealHandNo = null;
  trackedTurnCueToken = null;
  meId = playerId;
  replayState = null;
  closeLobbyPanels();
  el.lobbyView.classList.add('hidden');
  el.tableView.classList.remove('hidden');
  showNotice(el.notice, '');
  socket.emit('getHandHistory');
});

socket.on('roomState', (state) => {
  setActionPending(false);
  roomState = state;
  renderRoom();
});

socket.on('handHistoryData', ({ items }) => {
  if (!roomState) return;
  roomState.handHistory = items || [];
  renderHistory();
  renderProfitChart();
});

socket.on('handReplayData', (replay) => {
  replayState = replay || null;
  renderReplay();
});

socket.on('kicked', (payload) => {
  clearAllPending();
  setActionPending(false);
  showHandBanner('');
  trackedSeatDealHandNo = null;
  trackedTurnCueToken = null;
  showNotice(el.notice, payload?.reason || '你已被移出房间', 'error');
  roomState = null;
  replayState = null;
  el.tableView.classList.add('hidden');
  el.lobbyView.classList.remove('hidden');
  socket.emit('listRooms');
});

socket.on('errorMessage', (msg) => {
  clearAllPending();
  setActionPending(false);
  showNotice(el.tableView.classList.contains('hidden') ? el.notice : el.tableNotice, msg, 'error');
});

el.openCreatePanelBtn.addEventListener('click', () => {
  openCreatePanel();
});

el.openJoinPanelBtn.addEventListener('click', () => {
  openJoinPanel();
});

el.closeCreatePanelBtn.addEventListener('click', () => {
  closeLobbyPanels();
});

el.closeJoinPanelBtn.addEventListener('click', () => {
  closeLobbyPanels();
});

el.createBtn.addEventListener('click', () => {
  if (!ensureConnected()) return;
  if (createPending) {
    showNotice(el.notice, '正在创建房间，请稍候', 'error');
    return;
  }
  const name = ensureNickname();
  if (!name) {
    showNotice(el.notice, '请输入昵称', 'error');
    el.nameInput.focus();
    return;
  }
  const payload = collectCreateSettings();
  if (!payload.roomName) payload.roomName = '好友局';
  persistName();
  startCreatePending();
  socket.emit('createRoom', { name, ...payload });
});

el.joinBtn.addEventListener('click', () => {
  if (!ensureConnected()) return;
  if (joinPending) {
    showNotice(el.notice, '正在加入房间，请稍候', 'error');
    return;
  }
  const name = ensureNickname();
  if (!name) {
    showNotice(el.notice, '请输入昵称', 'error');
    el.nameInput.focus();
    return;
  }
  const roomId = el.joinRoomInput.value.trim().toUpperCase();
  if (!roomId) {
    showNotice(el.notice, '请输入房间号', 'error');
    el.joinRoomInput.focus();
    return;
  }
  persistName();
  emitJoinRequest({
    roomId,
    name,
    password: el.joinPasswordInput.value.trim(),
    spectator: el.joinSpectatorInput.checked,
  });
});

el.refreshLobbyBtn.addEventListener('click', () => {
  socket.emit('listRooms');
});

el.themeToggleBtn.addEventListener('click', () => {
  const idx = THEME_CYCLE.indexOf(uiTheme);
  uiTheme = THEME_CYCLE[(idx + 1 + THEME_CYCLE.length) % THEME_CYCLE.length];
  localStorage.setItem('holdem_theme', uiTheme);
  applyTheme();
  refreshThemeButton();
});

el.soundToggleBtn.addEventListener('click', () => {
  uiSoundEnabled = !uiSoundEnabled;
  localStorage.setItem('holdem_sound', uiSoundEnabled ? '1' : '0');
  refreshSoundButton();
  if (uiSoundEnabled) playTurnCue();
});

el.motionToggleBtn.addEventListener('click', () => {
  uiMotionMode = uiMotionMode === 'reduced' ? 'full' : 'reduced';
  localStorage.setItem('holdem_motion_mode', uiMotionMode);
  applyMotionMode();
  refreshMotionButton();
});

el.sideToggleBtn.addEventListener('click', () => {
  setSideCollapsed(!uiSideCollapsed, true);
});

el.actionPanelToggleBtn.addEventListener('click', () => {
  setActionPanelCollapsed(!uiActionPanelCollapsed, true);
  if (roomState) renderActions();
});

el.profitFilterAllBtn.addEventListener('click', () => setProfitFilter('all'));
el.profitFilterMeBtn.addEventListener('click', () => setProfitFilter('me'));

el.densityToggleBtn.addEventListener('click', () => {
  uiSeatDensity = uiSeatDensity === 'compact' ? 'auto' : 'compact';
  localStorage.setItem('holdem_seat_density', uiSeatDensity);
  refreshDensityButton();
  if (roomState) renderSeatMap();
});

el.focusMeBtn.addEventListener('click', () => {
  const mine = el.seatMap.querySelector('.seat-node.me');
  if (!mine) return;
  mine.classList.remove('spotlight');
  void mine.offsetWidth;
  mine.classList.add('spotlight');
  mine.scrollIntoView({ behavior: uiMotionMode === 'reduced' ? 'auto' : 'smooth', block: 'center', inline: 'center' });
});

el.takeSeatBtn.addEventListener('click', () => socket.emit('takeSeat'));
el.becomeSpectatorBtn.addEventListener('click', () => socket.emit('becomeSpectator'));
el.readyBtn.addEventListener('click', () => socket.emit('toggleReady'));
el.startBtn.addEventListener('click', () => socket.emit('startHand'));

el.leaveBtn.addEventListener('click', () => {
  clearAllPending();
  setActionPending(false);
  showHandBanner('');
  trackedSeatDealHandNo = null;
  trackedTurnCueToken = null;
  socket.emit('leaveRoom');
  roomState = null;
  replayState = null;
  closeLobbyPanels();
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
    showNotice(el.tableNotice, '房间号已复制', 'ok');
  } catch {
    const ok = fallbackCopy(text);
    if (ok) {
      showNotice(el.tableNotice, '房间号已复制', 'ok');
      return;
    }
    window.prompt('复制房间号（手动复制）', text);
    showNotice(el.tableNotice, '当前浏览器限制复制，已弹出手动复制框', 'error');
  }
});

el.foldBtn.addEventListener('click', () => sendPlayerAction({ action: 'fold' }));
el.checkBtn.addEventListener('click', () => sendPlayerAction({ action: 'check' }));
el.callBtn.addEventListener('click', () => sendPlayerAction({ action: 'call' }));
el.allinBtn.addEventListener('click', () => sendPlayerAction({ action: 'allin' }));

el.betBtn.addEventListener('click', () => {
  const amount = parseNum(el.betInput.value, 0);
  if (!roomState?.actionState) return;
  const action = roomState.actionState.canBet ? 'bet' : 'raise';
  sendPlayerAction({ action, amount });
});

quickRaiseButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    if (!roomState?.actionState || btn.disabled) return;
    const target = parseNum(btn.dataset.target, 0);
    if (!target) return;
    el.betInput.value = String(target);
    const action = roomState.actionState.canBet ? 'bet' : 'raise';
    sendPlayerAction({ action, amount: target });
  });
});

el.betInput.addEventListener('input', () => {
  syncQuickRaiseActive();
});

el.straddleBtn.addEventListener('click', () => {
  const amount = parseNum(el.straddleInput.value, 0);
  sendPlayerAction({ action: 'straddle', amount });
});

el.skipStraddleBtn.addEventListener('click', () => {
  sendPlayerAction({ action: 'skipstraddle' });
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
  applySideLayout();
  if (roomState) renderRoom();
});

bindMobileSwipeControls();
loadName();
applyTheme();
applyMotionMode();
refreshPendingButtons();
refreshThemeButton();
refreshSoundButton();
refreshMotionButton();
refreshDensityButton();
refreshActionPanelToggleButton();
if (uiProfitFilter !== 'me' && uiProfitFilter !== 'all') uiProfitFilter = 'all';
refreshProfitFilterButtons();
applySideLayout();
applyActionPanelCollapsed();
(() => {
  const params = new URLSearchParams(window.location.search);
  const room = (params.get('room') || '').trim().toUpperCase();
  if (room) {
    el.joinRoomInput.value = room;
    openJoinPanel();
    showNotice(el.notice, `已填入邀请房间号：${room}`);
  }
})();
socket.emit('listRooms');
