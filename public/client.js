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
let uiSideTab = localStorage.getItem('holdem_side_tab') || 'chips';
let uiSocialAnimEnabled = localStorage.getItem('holdem_social_anim') !== '0';
let uiEmoteSoundPack = localStorage.getItem('holdem_emote_sound') || 'classic';
let uiSocialCollapsed = localStorage.getItem('holdem_social_collapsed')
  ? localStorage.getItem('holdem_social_collapsed') === '1'
  : true;
let bannerTimer = null;
let trackedHandNo = null;
let trackedPhase = null;
let trackedResultHandNo = null;
let trackedCommunityHandNo = null;
let trackedCommunityCount = 0;
let communityVisibleCards = [];
let communityTargetCards = [];
let communityRevealTimer = null;
let communityRevealKnown = false;
let trackedSeatDealHandNo = null;
let trackedTurnCueToken = null;
let raiseUiExpanded = false;
let preActionMode = null;
let preActionToken = null;
let actionCueTimer = null;
let serverClockOffsetMs = 0;
let seatPickMode = false;
let audioCtx = null;
let swipeStart = null;
let trackedLastActionByPlayerId = new Map();
let localActionCueEchoes = [];
let pendingPotPushAnimation = null;
let potPushCleanupTimer = null;
let pendingCappuccinoCelebration = null;
let cappuccinoCleanupTimer = null;
let trackedCappuccinoHandNo = null;
let trackedSeatedPlayerIds = new Set();
let seatJoinCueKnown = false;
let socialUnreadCount = 0;
let socialSeenChatCount = 0;
let socialCounterState = null;
let socialCounterTimer = null;
let seatInteractTargetId = '';
let rebuyPromptToken = '';
let resultVisualLock = null;

const REQUEST_TIMEOUT_MS = 7000;
const ACTION_PENDING_MS = 1200;
const LOCAL_CUE_ECHO_MS = 1400;
const COMMUNITY_REVEAL_GAP_MS = 500;
const LOBBY_REFRESH_INTERVAL_MS = 1000;

const $ = (id) => document.getElementById(id);

const el = {
  lobbyView: $('lobbyView'),
  tableView: $('tableView'),
  notice: $('notice'),
  tableNotice: $('tableNotice'),
  sideDrawerBackdrop: $('sideDrawerBackdrop'),

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
  changeSeatBtn: $('changeSeatBtn'),
  takeSeatBtn: $('takeSeatBtn'),
  becomeSpectatorBtn: $('becomeSpectatorBtn'),
  readyBtn: $('readyBtn'),
  rebuyBtn: $('rebuyBtn'),
  startBtn: $('startBtn'),
  leaveBtn: $('leaveBtn'),

  phaseText: $('phaseText'),
  handTypeText: $('handTypeText'),
  potText: $('potText'),
  potHeroText: $('potHeroText'),
  betText: $('betText'),
  streetBetTotalText: $('streetBetTotalText'),
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
  straddleStateText: $('straddleStateText'),
  turnWarning: $('turnWarning'),

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
  lastHandBox: $('lastHandBox'),
  replayBox: $('replayBox'),

  actionPanel: $('actionPanel'),
  actionPanelToggleBtn: $('actionPanelToggleBtn'),
  actionInfo: $('actionInfo'),
  actionMiniText: $('actionMiniText'),
  normalActionBox: $('normalActionBox'),
  quickRaiseBox: $('quickRaiseBox'),
  raiseControlBox: $('raiseControlBox'),
  betRangeLabel: $('betRangeLabel'),
  betRangeValue: $('betRangeValue'),
  betRangeInput: $('betRangeInput'),
  raiseCollapseBtn: $('raiseCollapseBtn'),
  preActionBox: $('preActionBox'),
  preCheckFoldBtn: $('preCheckFoldBtn'),
  preCheckBtn: $('preCheckBtn'),
  preActionClearBtn: $('preActionClearBtn'),
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
  emoteLayer: $('emoteLayer'),
  seatInteractMenu: $('seatInteractMenu'),
  socialLauncherBtn: $('socialLauncherBtn'),
  socialLauncherBadge: $('socialLauncherBadge'),
  socialDock: $('socialDock'),
  socialBody: $('socialBody'),
  socialCollapseBtn: $('socialCollapseBtn'),
  socialSoundBtn: $('socialSoundBtn'),
  socialAnimBtn: $('socialAnimBtn'),
  counterRow: $('counterRow'),
  counterText: $('counterText'),
  counterBtn: $('counterBtn'),
  socialChatFeed: $('socialChatFeed'),
  socialChatInput: $('socialChatInput'),
  socialChatSendBtn: $('socialChatSendBtn'),
  rebuyModal: $('rebuyModal'),
  rebuyModalText: $('rebuyModalText'),
  rebuyConfirmBtn: $('rebuyConfirmBtn'),
  rebuyDeclineBtn: $('rebuyDeclineBtn'),
};

const quickRaiseButtons = Array.from(document.querySelectorAll('.quick-raise-btn'));
const quickEmoteButtons = Array.from(document.querySelectorAll('.quick-emote-btn'));
const propEmoteButtons = Array.from(document.querySelectorAll('.prop-emote-btn'));
const sideTabButtons = Array.from(document.querySelectorAll('.side-tab-btn'));
const sidePanes = Array.from(document.querySelectorAll('.side-pane'));
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
const QUICK_EMOTE_META = {
  like: { label: '👍', emoji: '👍' },
  laugh: { label: '😂', emoji: '😂' },
  wow: { label: '😮', emoji: '😮' },
  cry: { label: '😭', emoji: '😭' },
  '666': { label: '🔥', emoji: '🔥' },
  grin: { label: '😀', emoji: '😀' },
  joy: { label: '😂', emoji: '😂' },
  rofl: { label: '🤣', emoji: '🤣' },
  wink: { label: '😉', emoji: '😉' },
  kiss: { label: '😘', emoji: '😘' },
  cool: { label: '😎', emoji: '😎' },
  think: { label: '🤔', emoji: '🤔' },
  shock: { label: '😮', emoji: '😮' },
  sob: { label: '😭', emoji: '😭' },
  angry: { label: '😡', emoji: '😡' },
  facepalm: { label: '🤦', emoji: '🤦' },
  clap: { label: '👏', emoji: '👏' },
  ok: { label: '👌', emoji: '👌' },
  pray: { label: '🙏', emoji: '🙏' },
  muscle: { label: '💪', emoji: '💪' },
  party: { label: '🎉', emoji: '🎉' },
  beer: { label: '🍻', emoji: '🍻' },
  coffee: { label: '☕', emoji: '☕' },
  money: { label: '💰', emoji: '💰' },
  spade: { label: '♠️', emoji: '♠️' },
  fire: { label: '🔥', emoji: '🔥' },
  heart: { label: '❤️', emoji: '❤️' },
  skull: { label: '💀', emoji: '💀' },
  eyes: { label: '👀', emoji: '👀' },
};
const PROP_EMOTE_META = {
  egg: { label: '鸡蛋', emoji: '🥚' },
  flower: { label: '送花', emoji: '🌹' },
  water: { label: '泼水', emoji: '💦' },
  rocket: { label: '火箭', emoji: '🚀' },
  kiss: { label: '飞吻', emoji: '😘' },
  tomato: { label: '番茄', emoji: '🍅' },
};
const EMOTE_SOUND_PACK_LABEL = {
  off: '关',
  classic: '经典',
  fun: '欢乐',
};
const EMOTE_SOUND_PACK_CYCLE = ['classic', 'fun', 'off'];
const ACTION_VOICE_SRC = {
  check: '/audio/check-zh.mp3',
  call: '/audio/call-zh.mp3',
  bet: '/audio/bet-zh.mp3',
  raise: '/audio/raise-zh.mp3',
  fold: '/audio/fold-zh.mp3',
  allin: '/audio/allin-en.mp3',
  seatjoin: '/audio/seatjoin-zh.mp3',
  straddle: '/audio/straddle-zh.mp3',
  skipstraddle: '/audio/skipstraddle-zh.mp3',
};
const actionVoiceCache = {};
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
  if (el.sideToggleBtn.classList.contains('settings-launcher')) {
    el.sideToggleBtn.classList.toggle('active', !uiSideCollapsed);
    const text = uiSideCollapsed ? '打开设置边栏' : '收起设置边栏';
    el.sideToggleBtn.title = text;
    el.sideToggleBtn.setAttribute('aria-label', text);
    return;
  }
  el.sideToggleBtn.textContent = uiSideCollapsed ? '展开边栏' : '收起边栏';
}

function refreshSideTabs() {
  if (uiSideTab === 'config' || uiSideTab === 'admin') uiSideTab = 'room';
  if (uiSideTab === 'chat') uiSideTab = 'settings';
  const validTabs = new Set(['chips', 'chart', 'history', 'room', 'settings']);
  if (!validTabs.has(uiSideTab)) uiSideTab = 'chips';
  sideTabButtons.forEach((btn) => {
    const active = btn.dataset.sideTab === uiSideTab;
    btn.classList.toggle('active', active);
  });
  sidePanes.forEach((pane) => {
    pane.classList.toggle('active', pane.dataset.sidePane === uiSideTab);
  });
}

function setSideTab(tab, persist = true) {
  uiSideTab = tab || 'chips';
  if (persist) {
    localStorage.setItem('holdem_side_tab', uiSideTab);
  }
  refreshSideTabs();
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
  const tableActive = !el.tableView.classList.contains('hidden');
  const drawerMode = useSideDrawerMode();
  const drawerOpen = tableActive && drawerMode && !uiSideCollapsed;
  const sideCollapsed = !tableActive || uiSideCollapsed || drawerMode;
  el.tableGrid.classList.toggle('side-collapsed', sideCollapsed);
  el.tableGrid.classList.toggle('side-drawer-open', drawerOpen);
  el.sidePanel.classList.toggle('hidden', !tableActive || uiSideCollapsed);
  if (el.sideDrawerBackdrop) {
    el.sideDrawerBackdrop.classList.toggle('hidden', !drawerOpen);
  }
  document.body.classList.toggle('side-drawer-open', drawerOpen);
  if (drawerOpen) {
    el.sidePanel.scrollTop = 0;
  }
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
    osc.frequency.exponentialRampToValueAtTime(520, now + 0.16);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.2, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.2);
    if (navigator.vibrate) navigator.vibrate([35, 30, 45]);
  } catch {
    // Ignore autoplay/device limitations.
  }
}

function getActionVoiceBase(kind) {
  const src = ACTION_VOICE_SRC[kind];
  if (!src) return null;
  if (!actionVoiceCache[kind]) {
    const audio = new Audio(src);
    audio.preload = 'auto';
    audio.volume = 0.95;
    actionVoiceCache[kind] = audio;
  }
  return actionVoiceCache[kind];
}

function warmupActionVoices() {
  Object.keys(ACTION_VOICE_SRC).forEach((kind) => {
    const audio = getActionVoiceBase(kind);
    if (!audio) return;
    try {
      audio.load();
    } catch {
      // Ignore preload limitations.
    }
  });
}

function playActionVoice(kind, onFail) {
  const base = getActionVoiceBase(kind);
  if (!base) return false;
  try {
    // Clone to allow repeated rapid actions without waiting for current playback.
    const clip = base.cloneNode(true);
    clip.volume = 0.95;
    const p = clip.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        if (typeof onFail === 'function') onFail();
      });
    }
    return true;
  } catch {
    if (typeof onFail === 'function') onFail();
    return false;
  }
}

function playToneCue(kind) {
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return;
  try {
    if (!audioCtx || audioCtx.state === 'closed') {
      audioCtx = new AudioCtor();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }

    const presets = {
      check: {
        tones: [{ type: 'triangle', from: 480, to: 400, dur: 0.09, gain: 0.12, delay: 0 }],
        vibrate: 22,
      },
      call: {
        tones: [{ type: 'triangle', from: 640, to: 520, dur: 0.11, gain: 0.14, delay: 0 }],
        vibrate: [22, 20, 24],
      },
      raise: {
        tones: [
          { type: 'sawtooth', from: 700, to: 980, dur: 0.12, gain: 0.16, delay: 0 },
          { type: 'sawtooth', from: 860, to: 1160, dur: 0.12, gain: 0.15, delay: 0.05 },
        ],
        vibrate: [28, 24, 36],
      },
      bet: {
        tones: [
          { type: 'sawtooth', from: 680, to: 940, dur: 0.11, gain: 0.15, delay: 0 },
          { type: 'triangle', from: 820, to: 1040, dur: 0.1, gain: 0.13, delay: 0.045 },
        ],
        vibrate: [26, 22, 30],
      },
      fold: {
        tones: [{ type: 'triangle', from: 300, to: 190, dur: 0.11, gain: 0.1, delay: 0 }],
        vibrate: 18,
      },
      allin: {
        tones: [
          { type: 'square', from: 900, to: 1260, dur: 0.12, gain: 0.18, delay: 0 },
          { type: 'square', from: 980, to: 1480, dur: 0.14, gain: 0.2, delay: 0.055 },
        ],
        vibrate: [42, 26, 56],
      },
      seatjoin: {
        tones: [
          { type: 'triangle', from: 620, to: 760, dur: 0.09, gain: 0.12, delay: 0 },
          { type: 'triangle', from: 760, to: 920, dur: 0.1, gain: 0.14, delay: 0.05 },
        ],
        vibrate: [18, 18, 20],
      },
      straddle: {
        tones: [
          { type: 'square', from: 780, to: 1120, dur: 0.12, gain: 0.16, delay: 0 },
          { type: 'triangle', from: 900, to: 1220, dur: 0.11, gain: 0.14, delay: 0.045 },
        ],
        vibrate: [30, 20, 30],
      },
    };
    const p = presets[kind] || presets.call;
    const now = audioCtx.currentTime;
    p.tones.forEach((tone) => {
      const start = now + (tone.delay || 0);
      const end = start + tone.dur + 0.03;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = tone.type;
      osc.frequency.setValueAtTime(tone.from, start);
      osc.frequency.exponentialRampToValueAtTime(tone.to, start + tone.dur);
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(tone.gain, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + tone.dur + 0.02);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(start);
      osc.stop(end);
    });
    if (navigator.vibrate && p.vibrate) navigator.vibrate(p.vibrate);
  } catch {
    // Ignore autoplay/device limitations.
  }
}

function playActionCue(kind) {
  if (!uiSoundEnabled) return;
  const voicePlayed = playActionVoice(kind, () => playToneCue(kind));
  if (voicePlayed) return;
  playToneCue(kind);
}

function resetActionCueTracking() {
  trackedLastActionByPlayerId = new Map();
  localActionCueEchoes = [];
}

function normalizeActionText(v) {
  return String(v || '').trim();
}

function detectActionCueKind(actionText) {
  const text = normalizeActionText(actionText).toLowerCase();
  if (!text) return null;
  if (text.includes('放弃 straddle') || text.includes('跳过 straddle') || text.includes('skipstraddle')) return 'skipstraddle';
  if (text.includes('straddle')) return 'straddle';
  if (text.includes('过牌')) return 'check';
  if (text.includes('弃牌')) return 'fold';
  if (text.includes('跟注')) return 'call';
  if (text.includes('全下')) return 'allin';
  if (text.includes('加注')) return 'raise';
  if (text.includes('下注')) return 'bet';
  return null;
}

function pruneLocalCueEchoes(nowMs = Date.now()) {
  if (!localActionCueEchoes.length) return;
  localActionCueEchoes = localActionCueEchoes.filter((item) => item && item.expiresAt > nowMs);
}

function markLocalCueEcho(kind) {
  const nowMs = Date.now();
  pruneLocalCueEchoes(nowMs);
  localActionCueEchoes.push({
    kind,
    expiresAt: nowMs + LOCAL_CUE_ECHO_MS,
  });
}

function shouldSkipLocalEcho(kind) {
  pruneLocalCueEchoes();
  const idx = localActionCueEchoes.findIndex((item) => item.kind === kind);
  if (idx < 0) return false;
  localActionCueEchoes.splice(idx, 1);
  return true;
}

function playLocalActionCue(kind) {
  markLocalCueEcho(kind);
  playActionCue(kind);
}

function trackPlayerActionCues(nextState) {
  const players = nextState?.players || [];
  if (!players.length) {
    trackedLastActionByPlayerId.clear();
    return;
  }

  if (trackedLastActionByPlayerId.size === 0) {
    players.forEach((p) => {
      trackedLastActionByPlayerId.set(p.id, {
        text: normalizeActionText(p.lastAction),
        seq: Number(p.lastActionSeq) || 0,
      });
    });
    return;
  }

  const changed = [];
  const activeIds = new Set();

  players.forEach((p) => {
    activeIds.add(p.id);
    const currentText = normalizeActionText(p.lastAction);
    const currentSeq = Number(p.lastActionSeq) || 0;
    const previous = trackedLastActionByPlayerId.get(p.id) || { text: '', seq: 0 };
    const seqChanged = currentSeq > (Number(previous.seq) || 0);
    const textChanged = Boolean(currentText && currentText !== previous.text);
    if (currentText && (seqChanged || textChanged)) {
      const kind = detectActionCueKind(currentText);
      if (kind) changed.push({ playerId: p.id, kind });
    }
    trackedLastActionByPlayerId.set(p.id, { text: currentText, seq: currentSeq });
  });

  for (const id of [...trackedLastActionByPlayerId.keys()]) {
    if (!activeIds.has(id)) trackedLastActionByPlayerId.delete(id);
  }

  if (!changed.length || el.tableView.classList.contains('hidden')) return;

  changed.forEach((item, idx) => {
    setTimeout(() => {
      if (!uiSoundEnabled) return;
      if (el.tableView.classList.contains('hidden')) return;
      if (item.playerId === meId && shouldSkipLocalEcho(item.kind)) return;
      playActionCue(item.kind);
    }, Math.min(220, idx * 90));
  });
}

function resetSeatJoinCueTracking() {
  trackedSeatedPlayerIds = new Set();
  seatJoinCueKnown = false;
}

function trackSeatJoinCue(nextState) {
  const players = nextState?.players || [];
  const current = new Set(players.map((p) => p.id));
  if (!seatJoinCueKnown) {
    trackedSeatedPlayerIds = current;
    seatJoinCueKnown = true;
    return;
  }

  const newcomers = players.filter((p) => !trackedSeatedPlayerIds.has(p.id));
  trackedSeatedPlayerIds = current;
  if (!newcomers.length || el.tableView.classList.contains('hidden')) return;

  newcomers.forEach((_, idx) => {
    setTimeout(() => {
      if (!uiSoundEnabled || el.tableView.classList.contains('hidden')) return;
      playActionCue('seatjoin');
    }, Math.min(220, idx * 90));
  });
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

function activeResultVisualLock() {
  const g = roomState?.game;
  if (!g?.finished || !resultVisualLock) return null;
  if (resultVisualLock.handNo !== g.handNo) return null;
  return resultVisualLock;
}

function displayStackForPlayer(player) {
  const lock = activeResultVisualLock();
  if (!player) return 0;
  if (lock && Object.prototype.hasOwnProperty.call(lock.stacksById, player.id)) {
    return Math.max(0, Number(lock.stacksById[player.id]) || 0);
  }
  return Math.max(0, Number(player.stack) || 0);
}

function displayStreetBetForPlayer(player) {
  const lock = activeResultVisualLock();
  if (!player) return 0;
  if (lock && Object.prototype.hasOwnProperty.call(lock.streetBetsById, player.id)) {
    return Math.max(0, Number(lock.streetBetsById[player.id]) || 0);
  }
  return Math.max(0, Number(player.betThisStreet) || 0);
}

function maybeReleaseResultVisualLock() {
  if (!resultVisualLock || !roomState?.game) {
    resultVisualLock = null;
    return false;
  }
  const g = roomState.game;
  if (!g.finished || g.handNo !== resultVisualLock.handNo) {
    resultVisualLock = null;
    return false;
  }
  const targetLen = Array.isArray(g.community) ? g.community.length : 0;
  const revealDone = communityVisibleCards.length >= targetLen && !communityRevealTimer;
  if (!revealDone) return false;
  resultVisualLock = null;
  return true;
}

function syncResultVisualLock(prevState, nextState) {
  const nextGame = nextState?.game;
  if (!nextGame?.finished || uiMotionMode === 'reduced') {
    resultVisualLock = null;
    return;
  }
  const handNo = nextGame.handNo;
  const sameHandPrev = Boolean(prevState?.game && prevState.game.handNo === handNo);
  const enteredFinished = Boolean(!sameHandPrev || !prevState.game?.finished);
  if (!enteredFinished && resultVisualLock?.handNo === handNo) return;

  const targetLen = Array.isArray(nextGame.community) ? nextGame.community.length : 0;
  if (targetLen <= communityVisibleCards.length) {
    resultVisualLock = null;
    return;
  }

  const sourcePlayers = sameHandPrev ? prevState.players || [] : nextState.players || [];
  const stacksById = {};
  const streetBetsById = {};
  sourcePlayers.forEach((p) => {
    stacksById[p.id] = Math.max(0, Number(p.stack) || 0);
    streetBetsById[p.id] = Math.max(0, Number(p.betThisStreet) || 0);
  });

  resultVisualLock = {
    handNo,
    potTotal: Math.max(0, Number((sameHandPrev ? prevState.game?.potTotal : nextGame.potTotal) || 0)),
    currentBet: Math.max(0, Number((sameHandPrev ? prevState.game?.currentBet : nextGame.currentBet) || 0)),
    stacksById,
    streetBetsById,
  };
}

function shouldDelayResultEffects() {
  return Boolean(activeResultVisualLock());
}

function closeRebuyModal() {
  if (el.rebuyModal) el.rebuyModal.classList.add('hidden');
}

function openRebuyModal() {
  if (!roomState || roomState.myRole !== 'player') return;
  const me = roomPlayerById(meId);
  if (!me) return;
  const token = `${roomState.roomId}:${roomState?.game?.handNo || 0}:${me.rebuyCount || 0}:${me.stack}`;
  if (me.stack > 0 || (roomState?.game && !roomState.game.finished && me.inHand)) {
    rebuyPromptToken = '';
    closeRebuyModal();
    return;
  }
  if (rebuyPromptToken === token) return;
  rebuyPromptToken = token;
  if (el.rebuyModalText) {
    el.rebuyModalText.textContent = `你当前筹码为 0，是否花费 ${roomState.settings.startingStack} 重新买入继续游戏？`;
  }
  if (el.rebuyModal) el.rebuyModal.classList.remove('hidden');
}

function canSelfChangeSeat() {
  if (roomState?.myRole !== 'player') return false;
  const me = roomPlayerById(meId);
  if (!me) return false;
  const inActiveHand = Boolean(roomState?.game && !roomState.game.finished && me.inHand && !me.folded);
  return !inActiveHand;
}

function setSeatPickMode(next, announce = true) {
  const canChange = canSelfChangeSeat();
  seatPickMode = Boolean(next) && canChange;
  if (announce) {
    if (seatPickMode) {
      showHandBanner('换座模式：点击任意目标座位', 'ok', 1200);
    } else {
      showHandBanner('已退出换座模式', 'info', 700);
    }
  }
  if (roomState) {
    renderStatus();
    renderSeatMap();
  }
}

function roomMemberName(id) {
  return roomPlayerById(id)?.name || roomState?.spectators?.find((s) => s.id === id)?.name || '-';
}

function clearPotPushAnimationLayer() {
  if (potPushCleanupTimer) {
    clearTimeout(potPushCleanupTimer);
    potPushCleanupTimer = null;
  }
  const layer = el.tableCanvas?.querySelector('.chip-push-layer');
  if (layer) layer.remove();
}

function queuePotPushAnimation(handNo, result) {
  pendingPotPushAnimation = {
    handNo: Number(handNo) || 0,
    result: result || null,
  };
}

function runPotPushAnimation(payload) {
  if (!payload || !el.tableCanvas || !el.seatMap) return;
  if (uiMotionMode === 'reduced') return;
  const winners = (payload.result?.winners || [])
    .map((w) => ({
      playerId: w?.playerId,
      amount: Math.max(0, Number(w?.amount) || 0),
    }))
    .filter((w) => w.playerId && w.amount > 0);
  if (!winners.length) return;

  const potNode = el.tableCanvas.querySelector('.pot-center');
  if (!potNode) return;

  const tableRect = el.tableCanvas.getBoundingClientRect();
  const potRect = potNode.getBoundingClientRect();
  const startX = potRect.left + potRect.width / 2 - tableRect.left;
  const startY = potRect.top + potRect.height / 2 - tableRect.top;

  const targets = winners
    .map((w) => {
      const player = roomState?.players?.find((p) => p.id === w.playerId);
      if (!player?.seat) return null;
      const seatNode = el.seatMap.querySelector(`.seat-node[data-seat='${player.seat}']`);
      if (!seatNode) return null;
      const rect = seatNode.getBoundingClientRect();
      return {
        ...w,
        endX: rect.left + rect.width / 2 - tableRect.left,
        endY: rect.top + rect.height / 2 - tableRect.top,
      };
    })
    .filter(Boolean);
  if (!targets.length) return;

  clearPotPushAnimationLayer();
  const layer = document.createElement('div');
  layer.className = 'chip-push-layer';
  layer.setAttribute('aria-hidden', 'true');
  el.tableCanvas.appendChild(layer);

  const total = targets.reduce((sum, t) => sum + t.amount, 0) || 1;
  let maxEndMs = 0;

  targets.forEach((target, winnerIdx) => {
    const tokenCount = Math.max(2, Math.min(10, Math.round(2 + (target.amount / total) * 8)));
    for (let i = 0; i < tokenCount; i += 1) {
      const chip = document.createElement('span');
      chip.className = 'chip-push-token';
      const delay = winnerIdx * 120 + i * 45;
      const duration = 520 + Math.floor(Math.random() * 240);
      const sx = startX + (Math.random() - 0.5) * 18;
      const sy = startY + (Math.random() - 0.5) * 10;
      const ex = target.endX + (Math.random() - 0.5) * 32;
      const ey = target.endY + (Math.random() - 0.5) * 24;
      chip.style.setProperty('--chip-sx', `${sx}px`);
      chip.style.setProperty('--chip-sy', `${sy}px`);
      chip.style.setProperty('--chip-ex', `${ex}px`);
      chip.style.setProperty('--chip-ey', `${ey}px`);
      chip.style.setProperty('--chip-delay', `${delay}ms`);
      chip.style.setProperty('--chip-dur', `${duration}ms`);
      layer.appendChild(chip);
      maxEndMs = Math.max(maxEndMs, delay + duration);
    }

    const gain = document.createElement('div');
    gain.className = 'chip-push-gain';
    gain.textContent = `+${target.amount}`;
    gain.style.setProperty('--gain-x', `${target.endX}px`);
    gain.style.setProperty('--gain-y', `${target.endY}px`);
    gain.style.setProperty('--gain-delay', `${winnerIdx * 120 + 220}ms`);
    layer.appendChild(gain);
    maxEndMs = Math.max(maxEndMs, winnerIdx * 120 + 900);
  });

  potPushCleanupTimer = setTimeout(() => {
    layer.remove();
    if (potPushCleanupTimer) {
      clearTimeout(potPushCleanupTimer);
      potPushCleanupTimer = null;
    }
  }, maxEndMs + 260);
}

function flushPendingPotPushAnimation() {
  if (!pendingPotPushAnimation) return;
  if (shouldDelayResultEffects()) return;
  const payload = pendingPotPushAnimation;
  pendingPotPushAnimation = null;
  runPotPushAnimation(payload);
}

function clearCappuccinoCelebration() {
  if (cappuccinoCleanupTimer) {
    clearTimeout(cappuccinoCleanupTimer);
    cappuccinoCleanupTimer = null;
  }
  const node = el.tableCanvas?.querySelector('.moneybag-celebration, .cappuccino-celebration');
  if (node) node.remove();
}

function queueCappuccinoCelebration(handNo, amount) {
  pendingCappuccinoCelebration = {
    handNo: Number(handNo) || 0,
    amount: Math.max(0, Number(amount) || 0),
  };
}

function runCappuccinoCelebration(payload) {
  if (!payload || !el.tableCanvas) return;
  if (uiMotionMode === 'reduced') {
    showHandBanner(`大胜 +${payload.amount}`, 'ok', 1200);
    return;
  }

  clearCappuccinoCelebration();

  const node = document.createElement('div');
  node.className = 'moneybag-celebration';
  node.setAttribute('aria-hidden', 'true');
  node.innerHTML = `
    <div class="moneybag-burst"></div>
    <div class="moneybag-main">
      <span class="moneybag-knot"></span>
      <span class="moneybag-body"></span>
      <span class="moneybag-mark">$</span>
    </div>
    <div class="moneybag-amount">+${payload.amount}</div>
  `;
  el.tableCanvas.appendChild(node);

  cappuccinoCleanupTimer = setTimeout(() => {
    node.remove();
    if (cappuccinoCleanupTimer) {
      clearTimeout(cappuccinoCleanupTimer);
      cappuccinoCleanupTimer = null;
    }
  }, 1200);
}

function flushPendingCappuccinoCelebration() {
  if (!pendingCappuccinoCelebration) return;
  if (shouldDelayResultEffects()) return;
  const payload = pendingCappuccinoCelebration;
  pendingCappuccinoCelebration = null;
  runCappuccinoCelebration(payload);
}

function suitSymbol(s) {
  return { S: '♠', H: '♥', D: '♦', C: '♣' }[s] || s;
}

function evalRankValue(card) {
  const r = card?.[0];
  if (r >= '2' && r <= '9') return Number(r);
  if (r === 'T') return 10;
  if (r === 'J') return 11;
  if (r === 'Q') return 12;
  if (r === 'K') return 13;
  if (r === 'A') return 14;
  return 0;
}

function evalSuitValue(card) {
  return card?.[1] || '';
}

function evalFindStraightHigh(ranks) {
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

function evaluateLiveHand(cards) {
  const valid = (cards || []).filter((c) => /^[2-9TJQKA][SHDC]$/.test(c));
  if (valid.length < 2) return { name: '-' };

  const ranks = valid.map(evalRankValue).filter((n) => n > 0);
  const suits = valid.map(evalSuitValue).filter(Boolean);
  const rankCounts = new Map();
  const suitMap = new Map();

  for (let i = 0; i < valid.length; i += 1) {
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
    const sfHigh = evalFindStraightHigh(flushRanksDesc);
    if (sfHigh > 0) return { name: sfHigh === 14 ? '皇家同花顺' : '同花顺' };
  }

  const four = groups.find((g) => g.count === 4);
  if (four) return { name: '四条' };

  const trips = groups.filter((g) => g.count === 3).map((g) => g.rank).sort((a, b) => b - a);
  const pairs = groups.filter((g) => g.count >= 2).map((g) => g.rank).sort((a, b) => b - a);
  if (trips.length >= 1) {
    let pairRank = pairs.find((r) => r !== trips[0]);
    if (!pairRank && trips.length >= 2) pairRank = trips[1];
    if (pairRank) return { name: '葫芦' };
  }

  if (flushSuit) return { name: '同花' };

  const straightHigh = evalFindStraightHigh(uniqueRanksDesc);
  if (straightHigh > 0) return { name: '顺子' };

  if (trips.length >= 1) return { name: '三条' };

  if (pairs.length >= 2) return { name: '两对' };

  if (pairs.length >= 1) return { name: '一对' };

  return { name: '高牌' };
}

function computeLiveMyHandName() {
  if (!roomState?.game) return '-';
  const me = roomPlayerById(meId);
  const holeCards = Array.isArray(me?.holeCards) ? me.holeCards.filter(Boolean) : [];
  if (holeCards.length < 2) return roomState?.myHandName || '-';
  const board = communityRevealKnown ? communityVisibleCards : roomState.game.community || [];
  const ev = evaluateLiveHand([...holeCards, ...board]);
  return ev?.name || roomState?.myHandName || '-';
}

function refreshLiveHandTypeText() {
  if (!el.handTypeText) return;
  el.handTypeText.textContent = computeLiveMyHandName();
}

function rankDisplay(rank) {
  return rank === 'T' ? '10' : rank;
}

function cardNode(code, hidden = false, extraClass = '') {
  const node = document.createElement('div');
  node.className = `card-face${hidden ? ' back' : ''}${extraClass ? ` ${extraClass}` : ''}`;
  if (!hidden) {
    node.textContent = `${rankDisplay(code[0])}${suitSymbol(code[1])}`;
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

function syncServerClock(serverNow, immediate = false) {
  const ts = Number(serverNow);
  if (!Number.isFinite(ts)) return;
  const targetOffset = ts - Date.now();
  if (immediate) {
    serverClockOffsetMs = targetOffset;
    return;
  }
  if (Math.abs(targetOffset - serverClockOffsetMs) > 5000) {
    serverClockOffsetMs = targetOffset;
    return;
  }
  serverClockOffsetMs = Math.round(serverClockOffsetMs * 0.7 + targetOffset * 0.3);
}

function nowByServer() {
  return Date.now() + serverClockOffsetMs;
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
      maxPlayers: parseNum(el.createMaxPlayersInput.value, 6),
      turnTimeSec: parseNum(el.createTurnInput.value, 25),
      sessionMinutes: parseNum(el.createSessionInput.value, 30),
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
      maxPlayers: parseNum(el.cfgMaxPlayersInput.value, 6),
      turnTimeSec: parseNum(el.cfgTurnInput.value, 25),
      sessionMinutes: parseNum(el.cfgSessionInput.value, 30),
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

    const leftSec = Math.max(0, Math.ceil((room.expiresAt - nowByServer()) / 1000));
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

function clearCommunityRevealTimer() {
  if (communityRevealTimer) {
    clearTimeout(communityRevealTimer);
    communityRevealTimer = null;
  }
}

function resetCommunityRevealState(handNo = null) {
  clearCommunityRevealTimer();
  trackedCommunityHandNo = handNo;
  trackedCommunityCount = 0;
  communityVisibleCards = [];
  communityTargetCards = [];
  communityRevealKnown = false;
}

function drawCommunityBoard(animateFrom = -1) {
  el.communityCards.innerHTML = '';
  communityVisibleCards.forEach((c, idx) => {
    const animate = animateFrom >= 0 && idx >= animateFrom;
    el.communityCards.appendChild(cardNode(c, false, animate ? 'deal-in' : ''));
  });
  for (let i = communityVisibleCards.length; i < 5; i += 1) {
    el.communityCards.appendChild(cardNode('XX', true));
  }
  refreshLiveHandTypeText();
  if (maybeReleaseResultVisualLock()) {
    renderStatus();
    renderSeatMap();
    renderStats();
    flushPendingPotPushAnimation();
    flushPendingCappuccinoCelebration();
  }
}

function scheduleCommunityReveal() {
  if (communityRevealTimer) return;
  if (communityVisibleCards.length >= communityTargetCards.length) return;

  const delay = communityVisibleCards.length > 0 ? COMMUNITY_REVEAL_GAP_MS : 0;
  communityRevealTimer = setTimeout(() => {
    communityRevealTimer = null;
    const idx = communityVisibleCards.length;
    const nextCard = communityTargetCards[idx];
    if (!nextCard) return;
    communityVisibleCards.push(nextCard);
    drawCommunityBoard(idx);
    scheduleCommunityReveal();
  }, delay);
}

function renderCommunity() {
  const cards = roomState?.game?.community || [];
  const handNo = roomState?.game?.handNo || null;
  if (handNo !== trackedCommunityHandNo) {
    resetCommunityRevealState(handNo);
  }

  if (!communityRevealKnown) {
    communityTargetCards = cards.slice();
    communityVisibleCards = cards.slice();
    trackedCommunityCount = cards.length;
    communityRevealKnown = true;
    drawCommunityBoard(-1);
    return;
  }

  if (cards.length < communityVisibleCards.length) {
    clearCommunityRevealTimer();
    communityTargetCards = cards.slice();
    communityVisibleCards = cards.slice();
    trackedCommunityCount = cards.length;
    drawCommunityBoard(-1);
    return;
  }

  communityTargetCards = cards.slice();
  trackedCommunityCount = cards.length;

  if (communityVisibleCards.length > communityTargetCards.length) {
    communityVisibleCards = communityTargetCards.slice();
  }

  drawCommunityBoard(-1);
  scheduleCommunityReveal();
  if (maybeReleaseResultVisualLock()) {
    renderStatus();
    renderSeatMap();
    renderStats();
    flushPendingPotPushAnimation();
    flushPendingCappuccinoCelebration();
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

  const seatBtn = document.createElement('button');
  seatBtn.className = 'btn tiny ghost';
  seatBtn.textContent = '换座';
  seatBtn.onclick = () => {
    const maxPlayers = roomState?.settings?.maxPlayers || 9;
    const seatText = window.prompt(`输入新座位号（1-${maxPlayers}）`);
    if (!seatText) return;
    const raw = Number(seatText);
    if (!Number.isFinite(raw)) return;
    const seat = clampInt(raw, 1, maxPlayers);
    socket.emit('changeSeat', { targetId, seat });
  };

  const banBtn = document.createElement('button');
  banBtn.className = 'btn tiny danger';
  banBtn.textContent = '封禁';
  banBtn.onclick = () => socket.emit('banMember', { targetId });

  box.appendChild(seatBtn);
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

function useSideDrawerMode() {
  return window.innerWidth <= 1080;
}

function compactStackText(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return String(Math.max(0, Math.floor(n)));
}

function stackVisualTier(stack, base) {
  const s = Math.max(0, Number(stack) || 0);
  const b = Math.max(1, Number(base) || 1);
  const ratio = s / b;
  if (s <= 0) return 0;
  if (ratio < 0.5) return 1;
  if (ratio < 1.2) return 2;
  if (ratio < 2.5) return 3;
  if (ratio < 4.5) return 4;
  return 5;
}

function createStackVisual(stack, base) {
  const tier = stackVisualTier(stack, base);
  const box = document.createElement('div');
  box.className = `seat-stack-visual tier-${tier}`;
  const pile = document.createElement('div');
  pile.className = 'chip-pile';
  const chipCount = tier <= 0 ? 1 : Math.min(7, tier + 2);
  for (let i = 0; i < chipCount; i += 1) {
    const chip = document.createElement('i');
    chip.style.setProperty('--chip-i', String(i));
    pile.appendChild(chip);
  }
  box.appendChild(pile);
  const txt = document.createElement('span');
  txt.textContent = `${Math.max(0, Math.floor(Number(stack) || 0))}`;
  box.appendChild(txt);
  return box;
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

function renderSeatMap() {
  el.seatMap.innerHTML = '';
  const players = roomState?.players || [];
  if (seatInteractTargetId && !players.some((p) => p.id === seatInteractTargetId)) {
    closeSeatInteractMenu();
  }
  const maxPlayers = roomState?.settings?.maxPlayers || 9;
  const baseStack = roomState?.settings?.startingStack || 2000;
  const handNo = roomState?.game?.handNo || null;
  const me = roomPlayerById(meId);
  const mySeat = me?.seat || null;
  const canChangeSeatNow = canSelfChangeSeat();
  if (!canChangeSeatNow) {
    seatPickMode = false;
  }
  el.seatMap.classList.toggle('seat-pick-mode', seatPickMode && canChangeSeatNow);
  const compact = isMobileView();
  const narrowMobile = compact && isNarrowMobileView();
  const layout = getSeatLayout(maxPlayers, compact);
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
    const pointIndex = mySeat ? (seat - mySeat + maxPlayers) % maxPlayers : seat - 1;
    const point = layout[pointIndex] || [50, 50];
    const p = players.find((x) => x.seat === seat);
    const isTurn = Boolean(p && roomState?.game?.turnId === p.id && !roomState?.game?.finished);

    const node = document.createElement('div');
    node.className = `seat-node${p ? '' : ' empty'}${p?.id === meId ? ' me' : ''}${isTurn ? ' turn' : ''}${preset.compact ? ' compact' : ''}${preset.dense ? ' dense' : ''}`;
    node.dataset.seat = String(seat);
    const emptyMinWidth = narrowMobile ? 56 : 68;
    const emptyMinHeight = narrowMobile ? 30 : 34;
    node.style.left = `${point[0]}%`;
    node.style.top = `${point[1]}%`;
    node.style.width = `${p ? preset.width : Math.max(emptyMinWidth, Math.floor(preset.width * 0.66))}px`;
    node.style.minHeight = `${p ? preset.height : Math.max(emptyMinHeight, Math.floor(preset.height * 0.5))}px`;
    node.style.zIndex = String((p?.id === meId ? 40 : 20) + Math.floor(point[1] / 10));

    const seatClickable = Boolean(seatPickMode && canChangeSeatNow && mySeat && seat !== mySeat);
    if (seatClickable) {
      node.classList.add('seat-selectable');
      node.addEventListener('click', (evt) => {
        if (evt.target instanceof Element && evt.target.closest('button')) return;
        if (p) {
          showHandBanner('该座位已有玩家，请选择空位', 'error', 900);
          return;
        }
        seatPickMode = false;
        socket.emit('changeSeat', { seat });
        showHandBanner(`请求换到 ${seat} 号位`, 'ok', 900);
        renderStatus();
        renderSeatMap();
      });
    }

    if (!p) {
      node.textContent = compact ? `${seat}空位` : `${seat}号位 空位`;
      el.seatMap.appendChild(node);
      continue;
    }

    node.dataset.playerId = p.id;
    if (seatInteractTargetId && seatInteractTargetId === p.id) {
      node.classList.add('social-targeted');
    }

    const head = document.createElement('div');
    head.className = 'seat-head';
    head.textContent = compact ? p.name : `${p.name} · ${seat}号位`;
    if (roomState.game?.dealerId === p.id) node.classList.add('seat-dealer');
    if (roomState.game?.smallBlindId === p.id) node.classList.add('seat-sb');
    if (roomState.game?.bigBlindId === p.id) node.classList.add('seat-bb');

    const badges = document.createElement('div');
    badges.className = 'badges';
    const badgeLimit = compact ? 4 : 99;
    const pushBadge = (text, klass = '') => {
      if (badges.childElementCount >= badgeLimit) return;
      addBadge(badges, text, klass);
    };
    if (roomState.game?.dealerId === p.id) pushBadge(compact ? '庄' : '庄家', 'role-dealer');
    if (roomState.game?.smallBlindId === p.id) pushBadge(compact ? 'SB' : '小盲', 'role-sb');
    if (roomState.game?.bigBlindId === p.id) pushBadge(compact ? 'BB' : '大盲', 'role-bb');
    if (p.id === roomState.hostId) pushBadge(compact ? '房' : '房主', 'gold');
    if (roomState.game?.turnId === p.id && !roomState.game?.finished) pushBadge(compact ? '行动' : '行动中', 'ok');
    if (!compact && p.ready) pushBadge('已准备', 'ok');
    if (p.folded) pushBadge(compact ? '弃' : '弃牌', 'warn');
    if (p.allIn) pushBadge('全下');
    if (!p.connected) pushBadge('离线', 'warn');

    const sub = document.createElement('div');
    sub.className = 'seat-sub';
    const displayStack = displayStackForPlayer(p);
    const displayStreetBet = displayStreetBetForPlayer(p);
    if (compact) {
      const stackText = compactStackText(displayStack);
      const action = !narrowMobile && p.lastAction ? ` · ${p.lastAction}` : '';
      sub.textContent = `后手 ${stackText}${action}`;
    } else {
      sub.textContent = `后手 ${displayStack} · 本轮 ${displayStreetBet} · 总投入 ${p.totalContribution}`;
    }

    const act = !compact ? document.createElement('div') : null;
    if (act) {
      act.className = 'seat-sub';
      act.textContent = p.lastAction || '等待中';
    }

    const streetBet = Math.max(0, Number(displayStreetBet) || 0);
    const betChip = document.createElement('div');
    betChip.className = `seat-bet-chip${streetBet > 0 ? ' active' : ''}`;
    betChip.textContent = compact ? `本轮 ${streetBet}` : `本轮下注 ${streetBet}`;
    const stackVisual = createStackVisual(displayStack, baseStack);

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
    node.appendChild(betChip);
    node.appendChild(stackVisual);
    node.appendChild(sub);
    if (act) node.appendChild(act);
    if (cards.children.length > 0) {
      node.appendChild(cards);
    }

    const admin = createAdminButtons(p.id);
    if (admin) node.appendChild(admin);

    if (!seatPickMode && p.id !== meId) {
      node.addEventListener('click', (evt) => {
        if (evt.target instanceof Element && evt.target.closest('button')) return;
        openSeatInteractMenu(p, node);
        renderSeatMap();
      });
    }

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
      seat: p.seat,
      stack: displayStackForPlayer(p),
      net: displayStackForPlayer(p) - base,
      rebuyCount: Math.max(0, Number(p.rebuyCount) || 0),
      rebuyTotal: Math.max(0, Number(p.rebuyTotal) || 0),
    }))
    .sort((a, b) => b.stack - a.stack);
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.net)));

  const summary = document.createElement('div');
  summary.className = 'stats-summary';
  summary.textContent = `在座 ${players.length} 人 · 已完成 ${roomState?.handHistory?.length || 0} 手`;
  el.statsList.appendChild(summary);

  rows.forEach((r) => {
    const row = document.createElement('div');
    row.className = `stat-row${r.id === meId ? ' me' : ''}`;

    const top = document.createElement('div');
    top.className = 'stat-top';
    const name = document.createElement('span');
    name.textContent = `${r.name} · 座位${r.seat}`;
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
    sub.textContent = `当前筹码 ${r.stack} · 重买 ${r.rebuyCount} 次（${r.rebuyTotal}）`;

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

function renderLastHandSummary() {
  if (!el.lastHandBox) return;
  const latest = roomState?.handHistory?.[0];
  if (!latest) {
    el.lastHandBox.textContent = '暂无战绩';
    return;
  }

  const winners = (latest.winners || [])
    .map((w) => `${w.name || roomMemberName(w.playerId)} +${w.amount}`)
    .join(' / ');
  const stacks = (latest.stacksAfter || [])
    .slice()
    .sort((a, b) => (b.stackAfter || 0) - (a.stackAfter || 0))
    .map((p) => `${p.name || roomMemberName(p.playerId)}: ${p.stackAfter ?? '-'}`)
    .join(' · ');

  el.lastHandBox.innerHTML = `<strong>Hand #${latest.handNo}</strong><br/>盲注 ${latest.blinds?.smallBlind || '-'} / ${latest.blinds?.bigBlind || '-'} (L${latest.blinds?.level || 1})<br/>赢家：${winners || '-'}<br/>结算后筹码：${stacks || '-'}`;
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
  const autoStartSec = roomState?.autoStartAt ? Math.max(0, Math.ceil((roomState.autoStartAt - nowByServer()) / 1000)) : 0;
  const autoStartDelayMs = Math.max(800, Number(roomState?.autoStartDelayMs || 2000));
  const autoStartRemainMs = roomState?.autoStartAt ? Math.max(0, roomState.autoStartAt - nowByServer()) : 0;
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

function updateBetRange(actionState, rawValue) {
  const canBetOrRaise = Boolean(actionState && (actionState.canBet || actionState.canRaise));
  if (!canBetOrRaise) {
    el.betInput.value = '';
    el.betRangeValue.textContent = '0';
    return;
  }

  const minTo = actionState.canBet ? actionState.minBetTo : actionState.minRaiseTo;
  const maxTo = actionState.maxTo;
  const fallback = Math.min(maxTo, minTo);
  const parsed = Number(rawValue);
  const target = clampInt(Number.isFinite(parsed) ? parsed : fallback, minTo, maxTo);

  el.betInput.min = String(minTo);
  el.betInput.max = String(maxTo);
  el.betInput.value = String(target);

  el.betRangeLabel.textContent = actionState.canBet ? '下注到' : '加注到';
  el.betRangeInput.min = String(minTo);
  el.betRangeInput.max = String(maxTo);
  el.betRangeInput.value = String(target);
  el.betRangeValue.textContent = String(target);
}

function renderQuickRaiseButtons(actionState) {
  const canQuick = Boolean(actionState && (actionState.canBet || actionState.canRaise) && raiseUiExpanded);
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

function triggerActionCue() {
  if (!el.actionPanel) return;
  el.actionPanel.classList.remove('turn-cue');
  void el.actionPanel.offsetWidth;
  el.actionPanel.classList.add('turn-cue');
  if (actionCueTimer) clearTimeout(actionCueTimer);
  actionCueTimer = setTimeout(() => {
    el.actionPanel.classList.remove('turn-cue');
  }, 1300);
}

function isWaitingForTurn() {
  if (!roomState?.game || roomState.game.finished) return false;
  if (roomState.myRole !== 'player') return false;
  const me = roomPlayerById(meId);
  if (!me || !me.inHand || me.folded || me.allIn) return false;
  return roomState.game.turnId !== meId;
}

function preActionLabel(mode) {
  if (mode === 'checkfold') return '过牌/弃牌';
  if (mode === 'check') return '仅过牌';
  return '';
}

function renderPreActionBox(visible) {
  el.preActionBox.classList.toggle('hidden', !visible);
  el.preCheckFoldBtn.classList.toggle('active', preActionMode === 'checkfold');
  el.preCheckBtn.classList.toggle('active', preActionMode === 'check');
  el.preActionClearBtn.disabled = !preActionMode;
}

function clearPreAction(resetToken = false) {
  preActionMode = null;
  if (resetToken) preActionToken = null;
}

function tryAutoPreAction(actionState) {
  if (!preActionMode || !actionState || actionPending) return false;
  if (actionState.mode !== 'normal') {
    clearPreAction(false);
    return false;
  }

  const token = `${roomState?.game?.handNo || 0}-${roomState?.game?.phase || ''}-${roomState?.game?.turnId || ''}-${actionState.toCall}`;
  if (preActionToken === token) return false;

  let action = null;
  if (preActionMode === 'checkfold') {
    action = actionState.canCheck && actionState.toCall === 0 ? 'check' : 'fold';
  } else if (preActionMode === 'check') {
    if (actionState.canCheck && actionState.toCall === 0) {
      action = 'check';
    } else {
      showHandBanner('提前操作“仅过牌”条件不满足，已取消', 'error', 1400);
      clearPreAction(false);
      renderPreActionBox(false);
      return false;
    }
  }

  if (!action) return false;
  preActionToken = token;
  clearPreAction(false);
  renderPreActionBox(false);
  showHandBanner(`提前操作：自动${action === 'check' ? '过牌' : '弃牌'}`, 'ok', 1100);
  playLocalActionCue(action);
  sendPlayerAction({ action });
  return true;
}

function renderActions() {
  const actionState = roomState?.actionState;
  const waitingForTurn = !actionState && isWaitingForTurn();
  if (!actionState && !waitingForTurn) {
    setActionPending(false);
    raiseUiExpanded = false;
    clearPreAction(true);
    el.actionPanel.classList.add('hidden');
    el.actionMiniText.classList.add('hidden');
    renderPreActionBox(false);
    return;
  }

  if (waitingForTurn) {
    raiseUiExpanded = false;
    el.actionPanel.classList.remove('hidden');
    applyActionPanelCollapsed();
    el.normalActionBox.classList.add('hidden');
    el.straddleBox.classList.add('hidden');
    el.raiseControlBox.classList.add('hidden');
    el.quickRaiseBox.classList.add('hidden');
    el.actionInfo.textContent = preActionMode
      ? `已设置提前操作：${preActionLabel(preActionMode)}`
      : '等待轮到你，可先设置提前操作';
    el.actionMiniText.textContent = preActionMode ? `提前操作：${preActionLabel(preActionMode)}` : '可设置提前操作';
    el.actionMiniText.classList.toggle('hidden', !uiActionPanelCollapsed);
    renderPreActionBox(true);
    return;
  }

  if (tryAutoPreAction(actionState)) {
    return;
  }

  const cueToken = `${roomState?.game?.handNo || 0}-${roomState?.game?.phase || ''}-${roomState?.game?.turnId || ''}-${actionState.mode}`;
  if (cueToken !== trackedTurnCueToken) {
    trackedTurnCueToken = cueToken;
    raiseUiExpanded = false;
    if (uiActionPanelCollapsed) {
      setActionPanelCollapsed(false, false);
    }
    showHandBanner(actionState.mode === 'straddle' ? '轮到你决定 straddle' : '轮到你行动', 'ok', 1100);
    playTurnCue();
    triggerActionCue();
  }

  el.actionPanel.classList.remove('hidden');
  applyActionPanelCollapsed();
  renderPreActionBox(false);

  if (actionState.mode === 'straddle') {
    raiseUiExpanded = false;
    el.normalActionBox.classList.add('hidden');
    el.straddleBox.classList.remove('hidden');
    el.quickRaiseBox.classList.add('hidden');
    el.raiseControlBox.classList.add('hidden');

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

  const canBetOrRaise = actionState.canBet || actionState.canRaise;
  const hasToCall = actionState.toCall > 0;
  const showCheck = actionState.canCheck && !hasToCall;
  const showCall = actionState.canCall && hasToCall;
  const minTo = actionState.canBet ? actionState.minBetTo : actionState.minRaiseTo;

  if (hasToCall) {
    el.actionInfo.textContent = `当前需跟注 ${actionState.toCall}，你可以跟注 / 加注 / 弃牌`;
    el.actionMiniText.textContent = `跟注 ${actionState.toCall}${canBetOrRaise ? ` / 最小加注到 ${minTo}` : ''}`;
  } else {
    el.actionInfo.textContent = `本轮尚无人下注，你可以过牌或下注`;
    el.actionMiniText.textContent = canBetOrRaise ? `过牌 / 最小下注到 ${minTo}` : '可过牌';
  }
  el.actionMiniText.classList.toggle('hidden', !uiActionPanelCollapsed);

  el.foldBtn.disabled = actionPending;
  el.checkBtn.disabled = !showCheck || actionPending;
  el.callBtn.disabled = !showCall || actionPending;
  el.allinBtn.disabled = actionState.maxTo <= 0 || actionPending;
  el.callBtn.textContent = showCall ? `跟注 ${actionState.toCall}` : '跟注';
  el.checkBtn.classList.toggle('hidden', !showCheck);
  el.callBtn.classList.toggle('hidden', !showCall);
  el.betBtn.classList.toggle('hidden', !canBetOrRaise);

  if (!canBetOrRaise) raiseUiExpanded = false;
  el.raiseControlBox.classList.toggle('hidden', !(canBetOrRaise && raiseUiExpanded));
  el.quickRaiseBox.classList.toggle('hidden', !(canBetOrRaise && raiseUiExpanded));
  el.betBtn.textContent = !raiseUiExpanded
    ? actionState.canBet
      ? '下注'
      : actionState.canRaise
        ? '加注'
        : '下注/加注'
    : actionState.canBet
      ? `确认下注 ${el.betRangeValue.textContent}`
      : `确认加注 ${el.betRangeValue.textContent}`;
  el.callBtn.classList.toggle('primary', showCall);
  el.checkBtn.classList.toggle('primary', showCheck);
  el.betBtn.classList.toggle('primary', !showCall);
  updateBetRange(actionState, el.betInput.value || minTo);
  if (raiseUiExpanded) {
    el.betBtn.textContent = actionState.canBet
      ? `确认下注 ${el.betRangeValue.textContent}`
      : `确认加注 ${el.betRangeValue.textContent}`;
  }
  el.betBtn.disabled = !canBetOrRaise || actionPending;
  renderQuickRaiseButtons(actionState);
  syncQuickRaiseActive();
}

function renderStatus() {
  const g = roomState?.game;
  const blind = roomState?.blindState || { smallBlind: roomState.settings.smallBlind, bigBlind: roomState.settings.bigBlind, level: 1 };
  if (!g?.finished) {
    resultVisualLock = null;
  }
  if (!g) {
    trackedHandNo = null;
    trackedPhase = null;
    trackedResultHandNo = null;
    trackedCappuccinoHandNo = null;
    trackedSeatDealHandNo = null;
    trackedTurnCueToken = null;
    pendingPotPushAnimation = null;
    pendingCappuccinoCelebration = null;
    clearCappuccinoCelebration();
    resetCommunityRevealState(null);
    raiseUiExpanded = false;
    clearPreAction(true);
  } else {
    if (trackedHandNo !== g.handNo) {
      trackedHandNo = g.handNo;
      resetCommunityRevealState(g.handNo);
      trackedPhase = g.phase;
      if (trackedCappuccinoHandNo !== g.handNo) trackedCappuccinoHandNo = null;
      trackedTurnCueToken = null;
      raiseUiExpanded = false;
      clearPreAction(true);
      showHandBanner(`第 ${g.handNo} 手牌开始`, 'ok', 1300);
    } else if (!g.finished && trackedPhase !== g.phase) {
      trackedPhase = g.phase;
      raiseUiExpanded = false;
      showHandBanner(phaseLabel(g.phase), 'info', 1000);
    }
    if (g.finished && trackedResultHandNo !== g.handNo) {
      trackedResultHandNo = g.handNo;
      const firstWinner = g.result?.winners?.[0];
      showHandBanner(firstWinner ? `${firstWinner.name || roomMemberName(firstWinner.playerId)} 赢下本手` : '本手结束', 'ok', 2100);
      queuePotPushAnimation(g.handNo, g.result);
      const myWin = Math.max(
        0,
        Number((g.result?.winners || []).find((w) => w?.playerId === meId)?.amount) || 0,
      );
      const halfBuyIn = Math.max(1, Math.floor((Number(roomState?.settings?.startingStack) || 0) / 2));
      if (myWin >= halfBuyIn && trackedCappuccinoHandNo !== g.handNo) {
        trackedCappuccinoHandNo = g.handNo;
        queueCappuccinoCelebration(g.handNo, myWin);
      }
    }
  }

  el.roomTitle.textContent = roomState?.roomName || '房间';
  el.roomIdText.textContent = roomState?.roomId || '-';
  if (el.roomModeText) {
    el.roomModeText.textContent = '';
  }

  const autoStartSec = roomState?.autoStartAt ? Math.max(0, Math.ceil((roomState.autoStartAt - nowByServer()) / 1000)) : 0;
  if (g?.finished && autoStartSec > 0) {
    el.phaseText.textContent = `本手结束 · ${autoStartSec}s后自动下一手`;
  } else {
    el.phaseText.textContent = g ? phaseLabel(g.phase) : '等待开局';
  }
  refreshLiveHandTypeText();
  const lock = activeResultVisualLock();
  const potTotal = lock ? lock.potTotal : g?.potTotal || 0;
  const currentBet = lock ? lock.currentBet : g?.currentBet || 0;
  const streetBetTotal = (roomState?.players || []).reduce((sum, p) => sum + displayStreetBetForPlayer(p), 0);
  el.potText.textContent = String(potTotal);
  el.potHeroText.textContent = String(potTotal);
  el.betText.textContent = String(currentBet);
  if (el.streetBetTotalText) el.streetBetTotalText.textContent = String(streetBetTotal);
  el.betHeroText.textContent = String(currentBet);
  el.turnText.textContent = roomMemberName(g?.turnId) || '-';

  el.dealerText.textContent = `庄家 ${roomMemberName(g?.dealerId)}`;
  el.sbText.textContent = `SB ${roomMemberName(g?.smallBlindId)}`;
  el.bbText.textContent = `BB ${roomMemberName(g?.bigBlindId)}`;
  el.blindText.textContent = `盲注 ${blind.smallBlind} / ${blind.bigBlind}`;
  el.blindLevelText.textContent = `级别 L${blind.level || 1}`;
  if (el.straddleStateText) {
    if (!roomState.settings.allowStraddle) {
      el.straddleStateText.textContent = 'straddle 关闭';
    } else if (g?.awaitingStraddle) {
      el.straddleStateText.textContent = `straddle 进行中：${roomMemberName(g.straddlePlayerId)}`;
    } else if (g && !g.finished) {
      el.straddleStateText.textContent = 'straddle 开启（翻牌前）';
    } else {
      el.straddleStateText.textContent = 'straddle 开启';
    }
  }
  if (roomState.settings.tournamentMode && blind.nextLevelAt) {
    const left = Math.max(0, Math.ceil((blind.nextLevelAt - nowByServer()) / 1000));
    el.nextBlindText.textContent = `下级别 ${fmtClock(left)}`;
  } else {
    el.nextBlindText.textContent = roomState.settings.tournamentMode ? '下级别 --:--' : '现金桌不涨盲';
  }

  const me = roomPlayerById(meId);
  el.myStackText.textContent = me ? String(displayStackForPlayer(me)) : '-';
  el.readyBtn.textContent = me?.ready ? '取消准备' : '准备';

  const isHost = roomState.hostId === meId;
  const isPlayer = roomState.myRole === 'player';
  const canChangeSeatNow = canSelfChangeSeat();
  if (!canChangeSeatNow) seatPickMode = false;

  el.readyBtn.disabled = !isPlayer;
  const waitingAuto = Boolean(g?.finished && autoStartSec > 0);
  el.startBtn.disabled = waitingAuto || !(roomState.canStart && isHost && isPlayer);
  el.startBtn.textContent = '开局';
  const showCenterStart = Boolean(isHost && (!g || g.finished));
  el.startBtn.classList.toggle('hidden', !showCenterStart);

  el.takeSeatBtn.classList.toggle('hidden', !roomState.canTakeSeat);
  el.becomeSpectatorBtn.classList.toggle('hidden', !roomState.canBecomeSpectator);
  el.changeSeatBtn.classList.toggle('hidden', !isPlayer);
  el.changeSeatBtn.disabled = !canChangeSeatNow;
  el.changeSeatBtn.textContent = seatPickMode ? '取消换座' : '换座';
  const canRebuy = Boolean(
    isPlayer &&
      me &&
      me.stack <= 0 &&
      (!g || g.finished || !me.inHand),
  );
  el.rebuyBtn.classList.toggle('hidden', !canRebuy);
  el.rebuyBtn.disabled = !canRebuy;
  el.rebuyBtn.textContent = `重新买入 ${roomState.settings.startingStack}`;
  if (canRebuy) {
    openRebuyModal();
  } else {
    closeRebuyModal();
  }

  const sessionSec = Math.max(0, Math.ceil((roomState.sessionEndsAt - nowByServer()) / 1000));
  el.sessionTimer.textContent = `时长剩余 ${fmtClock(sessionSec)}`;

  const turnRawSec = g?.turnDeadlineAt ? Math.ceil((g.turnDeadlineAt - nowByServer()) / 1000) : null;
  const turnSec = turnRawSec === null ? null : Math.max(0, turnRawSec);
  el.turnTimerText.textContent = turnSec === null ? '--' : turnSec > 0 ? `${turnSec}s` : '即将结算';
  const myTurn = Boolean(g && !g.finished && g.turnId === meId);
  const urgentTurn = Boolean(myTurn && turnSec !== null && turnSec > 0 && turnSec <= 8);
  el.turnTimerText.classList.toggle('turn-timer-urgent', urgentTurn);

  if (el.turnWarning) {
    let warning = '';
    if (myTurn && turnSec !== null && turnSec > 0 && turnSec <= 12) {
      if (roomState?.actionState?.mode === 'straddle') {
        warning = `请在 ${turnSec}s 内决定是否 straddle，超时将自动跳过`;
      } else {
        const timeoutAction = roomState?.actionState?.toCall > 0 ? '弃牌' : '过牌';
        warning = `倒计时 ${turnSec}s，超时将自动${timeoutAction}`;
      }
    } else if (myTurn && turnRawSec !== null && turnRawSec <= 0) {
      warning = '等待服务器处理超时动作...';
    }
    el.turnWarning.textContent = warning;
    el.turnWarning.classList.toggle('hidden', !warning);
    el.turnWarning.classList.toggle('urgent', urgentTurn);
  }

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

  el.saveConfigBtn.disabled = true;
  el.cfgRoomNameInput.value = roomState.roomName || '';
  el.cfgPasswordInput.value = roomState.hasPassword ? '已设置（隐藏）' : '无';
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
}

function myDisplayName() {
  return roomPlayerById(meId)?.name || roomState?.spectators?.find((s) => s.id === meId)?.name || '';
}

function parseLogLine(rawLine) {
  const line = String(rawLine || '');
  const tm = line.match(/^(\d{1,2}:\d{2}:\d{2})(?:\s?(AM|PM))?\s+(.+)$/i);
  const timeText = tm ? `${tm[1]}${tm[2] ? ` ${tm[2].toUpperCase()}` : ''}` : '';
  const body = tm ? tm[3] : line;
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

function clearSocialCounter() {
  if (socialCounterTimer) {
    clearTimeout(socialCounterTimer);
    socialCounterTimer = null;
  }
  socialCounterState = null;
  if (el.counterRow) {
    el.counterRow.classList.add('hidden');
  }
}

function resetSocialState() {
  socialUnreadCount = 0;
  socialSeenChatCount = 0;
  seatInteractTargetId = '';
  clearSocialCounter();
  closeSeatInteractMenu();
  if (el.emoteLayer) el.emoteLayer.innerHTML = '';
  if (el.socialLauncherBadge) {
    el.socialLauncherBadge.classList.add('hidden');
    el.socialLauncherBadge.textContent = '0';
  }
}

function normalizeEmoteSoundPack(v) {
  if (v === 'off' || v === 'classic' || v === 'fun') return v;
  return 'classic';
}

function refreshSocialButtons() {
  if (el.socialSoundBtn) {
    el.socialSoundBtn.textContent = `互动音效：${EMOTE_SOUND_PACK_LABEL[uiEmoteSoundPack] || '经典'}`;
  }
  if (el.socialAnimBtn) {
    el.socialAnimBtn.textContent = `互动动画：${uiSocialAnimEnabled ? '开' : '关'}`;
  }
  if (el.socialCollapseBtn) {
    el.socialCollapseBtn.textContent = uiSocialCollapsed ? '打开' : '关闭';
  }
}

function refreshSocialUnreadBadge() {
  if (!el.socialLauncherBadge) return;
  if (!socialUnreadCount || !uiSocialCollapsed) {
    el.socialLauncherBadge.classList.add('hidden');
    el.socialLauncherBadge.textContent = '0';
    return;
  }
  el.socialLauncherBadge.classList.remove('hidden');
  el.socialLauncherBadge.textContent = String(Math.min(99, socialUnreadCount));
}

function applySocialDockState(persist = false) {
  if (!el.socialDock) return;
  el.socialDock.classList.toggle('collapsed', uiSocialCollapsed);
  el.socialDock.classList.toggle('hidden', uiSocialCollapsed);
  if (el.socialLauncherBtn) {
    el.socialLauncherBtn.classList.toggle('active', !uiSocialCollapsed);
  }
  if (!uiSocialCollapsed) socialUnreadCount = 0;
  refreshSocialUnreadBadge();
  refreshSocialButtons();
  if (persist) {
    localStorage.setItem('holdem_social_collapsed', uiSocialCollapsed ? '1' : '0');
  }
}

function collapseSocialDockAfterSend() {
  if (uiSocialCollapsed) return;
  uiSocialCollapsed = true;
  applySocialDockState(true);
}

function closeSeatInteractMenu() {
  seatInteractTargetId = '';
  if (!el.seatInteractMenu) return;
  el.seatInteractMenu.classList.add('hidden');
  el.seatInteractMenu.innerHTML = '';
}

function openSeatInteractMenu(targetPlayer, seatNode) {
  if (!targetPlayer || !seatNode || !el.seatInteractMenu || !el.tableCanvas) return;
  const targetId = String(targetPlayer.id || '');
  if (!targetId) return;
  if (seatInteractTargetId === targetId && !el.seatInteractMenu.classList.contains('hidden')) {
    closeSeatInteractMenu();
    return;
  }
  seatInteractTargetId = targetId;
  const menu = el.seatInteractMenu;
  const canKick = Boolean(roomState?.hostId === meId && targetId !== meId);
  const options = Object.entries(PROP_EMOTE_META)
    .map(([code, meta]) => `<button class="btn tiny seat-prop-btn" data-emote-code="${code}">${meta.emoji}</button>`)
    .join('');
  const admin = canKick
    ? '<div class="seat-interact-admin"><button class="btn tiny danger seat-kick-btn">踢出玩家</button></div>'
    : '';
  menu.innerHTML = `
    <div class="seat-interact-title">互动 ${targetPlayer.name || '玩家'}</div>
    <div class="seat-interact-actions">${options}</div>
    ${admin}
  `;
  menu.classList.remove('hidden');

  const tableRect = el.tableCanvas.getBoundingClientRect();
  const seatRect = seatNode.getBoundingClientRect();
  const anchorX = seatRect.left + seatRect.width / 2 - tableRect.left;
  const anchorY = seatRect.top - tableRect.top;
  const menuW = menu.offsetWidth || 220;
  const menuH = menu.offsetHeight || 96;
  const left = Math.max(8, Math.min(tableRect.width - menuW - 8, anchorX - menuW / 2));
  let top = anchorY - menuH - 8;
  if (top < 8) {
    top = Math.min(tableRect.height - menuH - 8, anchorY + 20);
  }
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;

  const buttons = Array.from(menu.querySelectorAll('.seat-prop-btn'));
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const code = String(btn.dataset.emoteCode || '').trim();
      if (!code || !seatInteractTargetId) return;
      sendEmote('prop', code, seatInteractTargetId);
      closeSeatInteractMenu();
      collapseSocialDockAfterSend();
    });
  });

  const kickBtn = menu.querySelector('.seat-kick-btn');
  if (kickBtn) {
    kickBtn.addEventListener('click', () => {
      if (!seatInteractTargetId) return;
      const who = targetPlayer.name || '该玩家';
      const ok = window.confirm(`确认踢出 ${who} 吗？踢出后对方会离开房间。`);
      if (!ok) return;
      socket.emit('kickMember', { targetId: seatInteractTargetId });
      closeSeatInteractMenu();
      showNotice(el.tableNotice, `已踢出 ${who}`, 'ok');
    });
  }
}

function emoteLabel(kind, code) {
  if (kind === 'quick') return QUICK_EMOTE_META[code]?.label || code;
  return PROP_EMOTE_META[code]?.label || code;
}

function emoteEmoji(kind, code) {
  if (kind === 'quick') return QUICK_EMOTE_META[code]?.emoji || '✨';
  return PROP_EMOTE_META[code]?.emoji || '🎯';
}

function playEmoteCue(event) {
  if (!uiSoundEnabled) return;
  const pack = normalizeEmoteSoundPack(uiEmoteSoundPack);
  if (pack === 'off') return;
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return;
  try {
    if (!audioCtx || audioCtx.state === 'closed') {
      audioCtx = new AudioCtor();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    const now = audioCtx.currentTime;
    const combo = Math.max(1, Number(event?.combo) || 1);
    const kind = String(event?.kind || '');
    const base = pack === 'fun' ? (kind === 'prop' ? 640 : 560) : kind === 'prop' ? 520 : 460;
    const high = base + 120 + Math.min(4, combo) * 45;
    const toneCount = pack === 'fun' ? 3 : 2;
    for (let i = 0; i < toneCount; i += 1) {
      const start = now + i * 0.045;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = pack === 'fun' ? 'triangle' : 'sine';
      const from = i === 0 ? base : base + 40 * i;
      const to = i === toneCount - 1 ? high : from + 55;
      osc.frequency.setValueAtTime(from, start);
      osc.frequency.exponentialRampToValueAtTime(Math.max(100, to), start + 0.08);
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(0.09 + Math.min(0.07, combo * 0.01), start + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.1);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(start);
      osc.stop(start + 0.11);
    }
  } catch {
    // Ignore device/autoplay limitations.
  }
}

function memberPointOnTable(memberId) {
  if (!memberId || !el.tableCanvas || !el.seatMap) return null;
  const tableRect = el.tableCanvas.getBoundingClientRect();
  const player = roomState?.players?.find((p) => p.id === memberId);
  if (player?.seat) {
    const node = el.seatMap.querySelector(`.seat-node[data-seat='${player.seat}']`);
    if (node) {
      const rect = node.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2 - tableRect.left,
        y: rect.top + rect.height / 2 - tableRect.top,
      };
    }
  }

  const spectators = roomState?.spectators || [];
  const idx = spectators.findIndex((s) => s.id === memberId);
  if (idx >= 0) {
    return {
      x: Math.max(44, tableRect.width - 48),
      y: Math.min(tableRect.height - 44, 66 + idx * 26),
    };
  }

  return {
    x: tableRect.width * 0.5,
    y: 64,
  };
}

function spawnQuickEmoteBubble(event) {
  if (!el.emoteLayer) return;
  const from = memberPointOnTable(event.fromId);
  if (!from) return;
  const node = document.createElement('div');
  node.className = 'emote-bubble';
  if ((event.combo || 1) > 1) node.classList.add('combo');
  node.style.setProperty('--bx', `${from.x}px`);
  node.style.setProperty('--by', `${from.y}px`);
  const emo = document.createElement('span');
  emo.className = 'emo';
  emo.textContent = emoteEmoji(event.kind, event.code);
  node.appendChild(emo);
  if ((event.combo || 1) > 1) {
    const combo = document.createElement('b');
    combo.className = 'emote-combo-tag';
    combo.textContent = `x${event.combo}`;
    node.appendChild(combo);
  }
  el.emoteLayer.appendChild(node);
  setTimeout(() => node.remove(), 5000);
}

function spawnPropEmote(event) {
  if (!el.emoteLayer) return;
  const from = memberPointOnTable(event.fromId);
  const to = memberPointOnTable(event.targetId);
  if (!from || !to) return;

  const shot = document.createElement('div');
  shot.className = `emote-shot${event.counter ? ' counter' : ''}${(event.combo || 1) >= 3 ? ' combo' : ''}`;
  shot.style.setProperty('--sx', `${from.x}px`);
  shot.style.setProperty('--sy', `${from.y}px`);
  shot.style.setProperty('--tx', `${to.x}px`);
  shot.style.setProperty('--ty', `${to.y}px`);
  shot.textContent = emoteEmoji(event.kind, event.code);
  el.emoteLayer.appendChild(shot);

  const impact = document.createElement('div');
  impact.className = 'emote-impact';
  if ((event.combo || 1) >= 3) impact.classList.add('combo');
  impact.style.setProperty('--ix', `${to.x}px`);
  impact.style.setProperty('--iy', `${to.y}px`);
  impact.innerHTML = `<span>${emoteEmoji(event.kind, event.code)}</span><small>${emoteLabel(event.kind, event.code)}${(event.combo || 1) > 1 ? ` x${event.combo}` : ''}</small>`;
  impact.style.animationDelay = '360ms';
  el.emoteLayer.appendChild(impact);

  setTimeout(() => shot.remove(), 1300);
  setTimeout(() => impact.remove(), 5000);
}

function spawnSocialMessageBubble(event) {
  if (!el.emoteLayer) return;
  const from = memberPointOnTable(event.fromId);
  if (!from) return;
  const node = document.createElement('div');
  node.className = 'social-msg-bubble';
  node.style.setProperty('--bx', `${from.x}px`);
  node.style.setProperty('--by', `${from.y}px`);
  const msg = document.createElement('span');
  msg.textContent = event.message || '';
  node.appendChild(msg);
  el.emoteLayer.appendChild(node);
  setTimeout(() => node.remove(), 5000);
}

function handleIncomingEmote(event) {
  if (!event || !roomState) return;
  if (event.roomId && event.roomId !== roomState.roomId) return;
  playEmoteCue(event);
  if (uiSocialAnimEnabled) {
    if (event.kind === 'prop' && event.targetId) spawnPropEmote(event);
    else spawnQuickEmoteBubble(event);
  }
  if (event.kind === 'prop' && event.targetId === meId && event.fromId !== meId) {
    socialCounterState = {
      fromId: event.fromId,
      code: event.code,
      expiresAt: Date.now() + 5200,
    };
    if (el.counterText) {
      el.counterText.textContent = `${event.fromName || roomMemberName(event.fromId)} 对你使用了 ${emoteLabel(event.kind, event.code)}，要反击吗？`;
    }
    if (el.counterRow) {
      el.counterRow.classList.remove('hidden');
    }
    if (socialCounterTimer) clearTimeout(socialCounterTimer);
    socialCounterTimer = setTimeout(() => {
      clearSocialCounter();
    }, 5200);
  }
}

function refreshSocialTargetState() {
  const players = roomState?.players || [];
  if (seatInteractTargetId && !players.some((p) => p.id === seatInteractTargetId)) {
    closeSeatInteractMenu();
  }
}

function sendEmote(kind, code, targetId = '', counter = false) {
  if (!roomState || !ensureConnected()) return;
  const payload = {
    kind,
    code,
  };
  if (targetId) payload.targetId = targetId;
  if (counter) payload.counter = true;
  socket.emit('sendEmote', payload);
}

function sendSocialChatMessage(rawMessage, opts = {}) {
  if (!roomState || !ensureConnected()) return false;
  const message = String(rawMessage || '').trim().slice(0, 120);
  if (!message) return false;
  socket.emit('chatMessage', { message });
  if (opts.overlay) {
    socket.emit('sendSocialMessage', { message });
  }
  return true;
}

function socialChatItemsFromLogs() {
  const lines = roomState?.logs || [];
  return lines
    .map((line) => parseLogLine(line))
    .filter((item) => item.kind === 'chat');
}

function renderSocialChatFeed() {
  if (!el.socialChatFeed) return;
  const chats = socialChatItemsFromLogs();
  if (chats.length > socialSeenChatCount) {
    const delta = chats.length - socialSeenChatCount;
    if (uiSocialCollapsed) socialUnreadCount += delta;
  }
  socialSeenChatCount = chats.length;
  if (!uiSocialCollapsed) socialUnreadCount = 0;
  refreshSocialUnreadBadge();

  const nearBottom = el.socialChatFeed.scrollHeight - el.socialChatFeed.scrollTop - el.socialChatFeed.clientHeight < 24;
  el.socialChatFeed.innerHTML = '';
  chats.slice(-28).forEach((item) => {
    const row = document.createElement('div');
    row.className = `mini-chat-item${item.sender === myDisplayName() ? ' mine' : ''}`;
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = `${item.sender}:`;
    const msg = document.createElement('span');
    msg.className = 'msg';
    msg.textContent = item.message || '';
    row.appendChild(who);
    row.appendChild(msg);
    el.socialChatFeed.appendChild(row);
  });
  if (nearBottom) {
    el.socialChatFeed.scrollTop = el.socialChatFeed.scrollHeight;
  }
}

function renderRoom() {
  if (!roomState) return;
  renderStatus();
  renderCommunity();
  renderSeatMap();
  flushPendingPotPushAnimation();
  flushPendingCappuccinoCelebration();
  renderSpectators();
  renderStats();
  renderBanned();
  renderHistory();
  renderLastHandSummary();
  renderReplay();
  renderActions();
  renderResult();
  renderLogs();
  refreshSocialTargetState();
  renderSocialChatFeed();
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
  syncServerClock(lobbyState.serverNow);
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
  resetActionCueTracking();
  resetSeatJoinCueTracking();
  resetCommunityRevealState(null);
  clearPotPushAnimationLayer();
  pendingPotPushAnimation = null;
  clearCappuccinoCelebration();
  pendingCappuccinoCelebration = null;
  trackedCappuccinoHandNo = null;
  rebuyPromptToken = '';
  closeRebuyModal();
  resetSocialState();
  if (el.lobbyView.classList.contains('hidden')) {
    showNotice(el.tableNotice, '连接已断开，正在尝试重连...', 'error');
  } else {
    showNotice(el.notice, '连接已断开，正在尝试重连...', 'error');
  }
});

socket.on('connect_error', () => {
  clearAllPending();
  setActionPending(false);
  resetActionCueTracking();
  resetSeatJoinCueTracking();
  resetCommunityRevealState(null);
  clearPotPushAnimationLayer();
  pendingPotPushAnimation = null;
  clearCappuccinoCelebration();
  pendingCappuccinoCelebration = null;
  trackedCappuccinoHandNo = null;
  rebuyPromptToken = '';
  closeRebuyModal();
  resetSocialState();
  if (el.lobbyView.classList.contains('hidden')) {
    showNotice(el.tableNotice, '连接失败，请检查网络后重试', 'error');
  } else {
    showNotice(el.notice, '连接失败，请检查网络后重试', 'error');
  }
});

socket.on('joinedRoom', ({ playerId }) => {
  clearAllPending();
  setActionPending(false);
  resetActionCueTracking();
  resetSeatJoinCueTracking();
  clearPotPushAnimationLayer();
  pendingPotPushAnimation = null;
  clearCappuccinoCelebration();
  pendingCappuccinoCelebration = null;
  trackedCappuccinoHandNo = null;
  raiseUiExpanded = false;
  seatPickMode = false;
  clearPreAction(true);
  trackedHandNo = null;
  trackedPhase = null;
  trackedResultHandNo = null;
  resetCommunityRevealState(null);
  trackedSeatDealHandNo = null;
  trackedTurnCueToken = null;
  rebuyPromptToken = '';
  closeRebuyModal();
  resetSocialState();
  meId = playerId;
  replayState = null;
  closeLobbyPanels();
  el.lobbyView.classList.add('hidden');
  el.tableView.classList.remove('hidden');
  applySideLayout();
  showNotice(el.notice, '');
  socket.emit('getHandHistory');
});

socket.on('roomState', (state) => {
  const prevState = roomState;
  setActionPending(false);
  trackPlayerActionCues(state);
  trackSeatJoinCue(state);
  syncResultVisualLock(prevState, state);
  roomState = state;
  syncServerClock(state?.serverNow, true);
  renderRoom();
});

socket.on('emoteEvent', (payload) => {
  handleIncomingEmote(payload);
});

socket.on('socialMessageEvent', (payload) => {
  if (!payload || !roomState) return;
  if (payload.roomId && payload.roomId !== roomState.roomId) return;
  spawnSocialMessageBubble(payload);
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
  resetActionCueTracking();
  resetSeatJoinCueTracking();
  clearPotPushAnimationLayer();
  pendingPotPushAnimation = null;
  clearCappuccinoCelebration();
  pendingCappuccinoCelebration = null;
  trackedCappuccinoHandNo = null;
  raiseUiExpanded = false;
  seatPickMode = false;
  clearPreAction(true);
  showHandBanner('');
  resetCommunityRevealState(null);
  trackedSeatDealHandNo = null;
  trackedTurnCueToken = null;
  rebuyPromptToken = '';
  closeRebuyModal();
  resetSocialState();
  showNotice(el.notice, payload?.reason || '你已被移出房间', 'error');
  roomState = null;
  replayState = null;
  el.tableView.classList.add('hidden');
  el.lobbyView.classList.remove('hidden');
  applySideLayout();
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

if (el.themeToggleBtn) {
  el.themeToggleBtn.addEventListener('click', () => {
    const idx = THEME_CYCLE.indexOf(uiTheme);
    uiTheme = THEME_CYCLE[(idx + 1 + THEME_CYCLE.length) % THEME_CYCLE.length];
    localStorage.setItem('holdem_theme', uiTheme);
    applyTheme();
    refreshThemeButton();
  });
}

if (el.soundToggleBtn) {
  el.soundToggleBtn.addEventListener('click', () => {
    uiSoundEnabled = !uiSoundEnabled;
    localStorage.setItem('holdem_sound', uiSoundEnabled ? '1' : '0');
    refreshSoundButton();
    if (uiSoundEnabled) playTurnCue();
  });
}

if (el.motionToggleBtn) {
  el.motionToggleBtn.addEventListener('click', () => {
    uiMotionMode = uiMotionMode === 'reduced' ? 'full' : 'reduced';
    localStorage.setItem('holdem_motion_mode', uiMotionMode);
    applyMotionMode();
    refreshMotionButton();
  });
}

if (el.sideToggleBtn) {
  el.sideToggleBtn.addEventListener('click', () => {
    const willCollapse = !uiSideCollapsed;
    setSideCollapsed(willCollapse, true);
    if (!willCollapse) setSideTab('settings', true);
    showHandBanner(willCollapse ? '已收起设置边栏' : '已展开设置边栏', willCollapse ? 'info' : 'ok', 800);
  });
}

sideTabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.sideTab || 'chips';
    setSideTab(tab, true);
  });
});

document.addEventListener('click', (evt) => {
  if (uiSideCollapsed || !useSideDrawerMode() || !roomState) return;
  const target = evt.target;
  if (!(target instanceof Element)) return;
  if (el.sidePanel.contains(target)) return;
  if (el.sideToggleBtn?.contains(target)) return;
  setSideCollapsed(true, true);
});

document.addEventListener('click', (evt) => {
  const target = evt.target;
  if (!(target instanceof Element)) return;
  if (target.closest('#seatInteractMenu')) return;
  if (target.closest('.seat-node')) return;
  closeSeatInteractMenu();
});

document.addEventListener('click', (evt) => {
  if (uiSocialCollapsed || !roomState) return;
  const target = evt.target;
  if (!(target instanceof Element)) return;
  if (target.closest('#socialDock')) return;
  if (target.closest('#socialLauncherBtn')) return;
  uiSocialCollapsed = true;
  applySocialDockState(true);
});

if (el.sideDrawerBackdrop) {
  el.sideDrawerBackdrop.addEventListener('click', () => {
    if (!uiSideCollapsed) {
      setSideCollapsed(true, true);
    }
  });
}

el.actionPanelToggleBtn.addEventListener('click', () => {
  setActionPanelCollapsed(!uiActionPanelCollapsed, true);
  if (roomState) renderActions();
});

el.profitFilterAllBtn.addEventListener('click', () => setProfitFilter('all'));
el.profitFilterMeBtn.addEventListener('click', () => setProfitFilter('me'));

if (el.densityToggleBtn) {
  el.densityToggleBtn.addEventListener('click', () => {
    uiSeatDensity = uiSeatDensity === 'compact' ? 'auto' : 'compact';
    localStorage.setItem('holdem_seat_density', uiSeatDensity);
    refreshDensityButton();
    if (roomState) renderSeatMap();
  });
}

if (el.focusMeBtn) {
  el.focusMeBtn.addEventListener('click', () => {
    const mine = el.seatMap.querySelector('.seat-node.me');
    if (!mine) return;
    mine.classList.remove('spotlight');
    void mine.offsetWidth;
    mine.classList.add('spotlight');
    mine.scrollIntoView({ behavior: uiMotionMode === 'reduced' ? 'auto' : 'smooth', block: 'center', inline: 'center' });
  });
}

el.changeSeatBtn.addEventListener('click', () => {
  if (!canSelfChangeSeat()) {
    showHandBanner('当前在手牌中，暂时不能换座', 'error', 1000);
    return;
  }
  setSeatPickMode(!seatPickMode, true);
});

el.takeSeatBtn.addEventListener('click', () => socket.emit('takeSeat'));
el.becomeSpectatorBtn.addEventListener('click', () => socket.emit('becomeSpectator'));
el.readyBtn.addEventListener('click', () => socket.emit('toggleReady'));
el.rebuyBtn.addEventListener('click', () => socket.emit('rebuy'));
el.startBtn.addEventListener('click', () => socket.emit('startHand'));

el.leaveBtn.addEventListener('click', () => {
  clearAllPending();
  setActionPending(false);
  resetActionCueTracking();
  resetSeatJoinCueTracking();
  clearPotPushAnimationLayer();
  pendingPotPushAnimation = null;
  clearCappuccinoCelebration();
  pendingCappuccinoCelebration = null;
  trackedCappuccinoHandNo = null;
  raiseUiExpanded = false;
  seatPickMode = false;
  clearPreAction(true);
  showHandBanner('');
  resetCommunityRevealState(null);
  trackedSeatDealHandNo = null;
  trackedTurnCueToken = null;
  rebuyPromptToken = '';
  closeRebuyModal();
  resetSocialState();
  socket.emit('leaveRoom');
  roomState = null;
  replayState = null;
  closeLobbyPanels();
  el.tableView.classList.add('hidden');
  el.lobbyView.classList.remove('hidden');
  applySideLayout();
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

el.foldBtn.addEventListener('click', () => {
  raiseUiExpanded = false;
  playLocalActionCue('fold');
  sendPlayerAction({ action: 'fold' });
});
el.checkBtn.addEventListener('click', () => {
  const actionState = roomState?.actionState;
  if (!actionState || !(actionState.canCheck && actionState.toCall === 0)) return;
  raiseUiExpanded = false;
  playLocalActionCue('check');
  sendPlayerAction({ action: 'check' });
});
el.callBtn.addEventListener('click', () => {
  const actionState = roomState?.actionState;
  if (!actionState || !(actionState.canCall && actionState.toCall > 0)) return;
  raiseUiExpanded = false;
  playLocalActionCue('call');
  sendPlayerAction({ action: 'call' });
});
el.allinBtn.addEventListener('click', () => {
  raiseUiExpanded = false;
  playLocalActionCue('allin');
  sendPlayerAction({ action: 'allin' });
});

el.betBtn.addEventListener('click', () => {
  const actionState = roomState?.actionState;
  if (!actionState || !(actionState.canBet || actionState.canRaise)) return;
  if (!raiseUiExpanded) {
    raiseUiExpanded = true;
    renderActions();
    return;
  }
  const amount = parseNum(el.betRangeInput.value || el.betInput.value, 0);
  const action = actionState.canBet ? 'bet' : 'raise';
  raiseUiExpanded = false;
  playLocalActionCue(action);
  sendPlayerAction({ action, amount });
});

el.raiseCollapseBtn.addEventListener('click', () => {
  raiseUiExpanded = false;
  if (roomState) renderActions();
});

quickRaiseButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    if (!roomState?.actionState || btn.disabled) return;
    const target = parseNum(btn.dataset.target, 0);
    if (!target) return;
    updateBetRange(roomState.actionState, target);
    const action = roomState.actionState.canBet ? 'bet' : 'raise';
    raiseUiExpanded = false;
    playLocalActionCue(action);
    sendPlayerAction({ action, amount: target });
  });
});

el.betInput.addEventListener('input', () => {
  if (!roomState?.actionState) return;
  updateBetRange(roomState.actionState, el.betInput.value);
  syncQuickRaiseActive();
});

el.betRangeInput.addEventListener('input', () => {
  if (!roomState?.actionState) return;
  updateBetRange(roomState.actionState, el.betRangeInput.value);
  raiseUiExpanded = true;
  if (roomState) renderActions();
  syncQuickRaiseActive();
});

el.preCheckFoldBtn.addEventListener('click', () => {
  if (!isWaitingForTurn()) return;
  preActionMode = 'checkfold';
  preActionToken = null;
  showHandBanner('已设置提前操作：过牌/弃牌', 'ok', 900);
  renderActions();
});

el.preCheckBtn.addEventListener('click', () => {
  if (!isWaitingForTurn()) return;
  preActionMode = 'check';
  preActionToken = null;
  showHandBanner('已设置提前操作：仅过牌', 'ok', 900);
  renderActions();
});

el.preActionClearBtn.addEventListener('click', () => {
  clearPreAction(false);
  showHandBanner('已取消提前操作', 'info', 700);
  if (roomState) renderActions();
});

el.straddleBtn.addEventListener('click', () => {
  const amount = parseNum(el.straddleInput.value, 0);
  playLocalActionCue('straddle');
  sendPlayerAction({ action: 'straddle', amount });
});

el.skipStraddleBtn.addEventListener('click', () => {
  playLocalActionCue('skipstraddle');
  sendPlayerAction({ action: 'skipstraddle' });
});

el.saveConfigBtn.addEventListener('click', () => {
  showNotice(el.tableNotice, '房间配置在创建后锁定，只支持查看', 'error');
  setSideTab('room', true);
});

if (el.socialCollapseBtn) {
  el.socialCollapseBtn.addEventListener('click', () => {
    uiSocialCollapsed = true;
    applySocialDockState(true);
  });
}

if (el.socialLauncherBtn) {
  el.socialLauncherBtn.addEventListener('click', () => {
    uiSocialCollapsed = !uiSocialCollapsed;
    applySocialDockState(true);
  });
}

if (el.socialAnimBtn) {
  el.socialAnimBtn.addEventListener('click', () => {
    uiSocialAnimEnabled = !uiSocialAnimEnabled;
    localStorage.setItem('holdem_social_anim', uiSocialAnimEnabled ? '1' : '0');
    refreshSocialButtons();
  });
}

if (el.socialSoundBtn) {
  el.socialSoundBtn.addEventListener('click', () => {
    const idx = EMOTE_SOUND_PACK_CYCLE.indexOf(uiEmoteSoundPack);
    const next = EMOTE_SOUND_PACK_CYCLE[(idx + 1 + EMOTE_SOUND_PACK_CYCLE.length) % EMOTE_SOUND_PACK_CYCLE.length];
    uiEmoteSoundPack = next;
    localStorage.setItem('holdem_emote_sound', uiEmoteSoundPack);
    refreshSocialButtons();
  });
}

quickEmoteButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const code = String(btn.dataset.emoteCode || '').trim();
    if (!code) return;
    sendEmote('quick', code);
    collapseSocialDockAfterSend();
  });
});

propEmoteButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const code = String(btn.dataset.emoteCode || '').trim();
    const targetId = String(seatInteractTargetId || '');
    if (!code || !targetId) {
      showNotice(el.tableNotice, '请先点击玩家卡片选择互动目标', 'error');
      return;
    }
    sendEmote('prop', code, targetId);
    collapseSocialDockAfterSend();
  });
});

if (el.counterBtn) {
  el.counterBtn.addEventListener('click', () => {
    if (!socialCounterState?.fromId || !socialCounterState?.code) return;
    sendEmote('prop', socialCounterState.code, socialCounterState.fromId, true);
    clearSocialCounter();
    collapseSocialDockAfterSend();
  });
}

if (el.socialChatSendBtn) {
  el.socialChatSendBtn.addEventListener('click', () => {
    if (!el.socialChatInput) return;
    if (sendSocialChatMessage(el.socialChatInput.value, { overlay: true })) {
      el.socialChatInput.value = '';
      collapseSocialDockAfterSend();
    }
  });
}

if (el.socialChatInput) {
  el.socialChatInput.addEventListener('keydown', (evt) => {
    if (evt.key !== 'Enter') return;
    evt.preventDefault();
    if (sendSocialChatMessage(el.socialChatInput.value, { overlay: true })) {
      el.socialChatInput.value = '';
      collapseSocialDockAfterSend();
    }
  });
}

if (el.sendChatBtn && el.chatInput) {
  el.sendChatBtn.addEventListener('click', () => {
    if (sendSocialChatMessage(el.chatInput.value, { overlay: false })) {
      el.chatInput.value = '';
    }
  });
}

if (el.rebuyConfirmBtn) {
  el.rebuyConfirmBtn.addEventListener('click', () => {
    closeRebuyModal();
    socket.emit('rebuy');
  });
}

if (el.rebuyDeclineBtn) {
  el.rebuyDeclineBtn.addEventListener('click', () => {
    closeRebuyModal();
    if (roomState?.settings?.allowSpectators) socket.emit('becomeSpectator');
    else socket.emit('leaveRoom');
  });
}

if (el.chatInput && el.sendChatBtn) {
  el.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') el.sendChatBtn.click();
  });
}

el.nameInput.addEventListener('change', persistName);

setInterval(() => {
  if (el.lobbyView.classList.contains('hidden')) {
    if (roomState) {
      renderStatus();
      renderResult();
    }
  } else {
    if (Date.now() - lastLobbyFetchAt > LOBBY_REFRESH_INTERVAL_MS && socket.connected) {
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
window.addEventListener(
  'pointerdown',
  () => {
    warmupActionVoices();
  },
  { once: true },
);
loadName();
applyTheme();
applyMotionMode();
refreshPendingButtons();
refreshThemeButton();
refreshSoundButton();
refreshMotionButton();
refreshDensityButton();
refreshActionPanelToggleButton();
refreshSideTabs();
uiEmoteSoundPack = normalizeEmoteSoundPack(uiEmoteSoundPack);
applySocialDockState();
refreshSocialTargetState();
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
