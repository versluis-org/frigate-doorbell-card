/*
 * Frigate Doorbell Card for Home Assistant
 *
 * Live view with push-to-talk (two-way audio via go2rtc), a scrubbable timeline with Frigate
 * recordings and review items, playback, and an optional chime on/off button.
 *
 * Everything goes through the Frigate integration in Home Assistant (with the user's own HA
 * login), so no extra proxies or tokens are needed. Only the camera entity is required:
 *
 *   type: custom:frigate-doorbell-card
 *   camera: camera.front_door
 *
 * https://github.com/versluis-org/frigate-doorbell-card
 */

const CARD_VERSION = '0.2.0';
const HLS_JS = 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.20/hls.min.js';
const TL_H = 84;                  // timeline height (px)
const CHUNK = 6 * 3600;           // fetch recordings in blocks of 6 hours
const LIVE_EDGE = 20;             // within 20 s of now = live
const WEBRTC_TIMEOUT = 8000;      // no direct connection within 8 s → stream via Home Assistant
const WEBRTC_RETRY_AFTER = 600000; // after a failed direct connection, use the HA route for 10 min
const MSE_CODECS = ['avc1.640029', 'avc1.64002A', 'avc1.640033', 'hvc1.1.6.L153.B0', 'mp4a.40.2', 'mp4a.40.5', 'flac', 'opus'];
const TICKS = [60, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200];

const STRINGS = {
  en: {
    live: 'LIVE', today: 'today', yesterday: 'yesterday',
    talk_hold: 'Hold to talk', talking: 'You are talking…', mic_on: 'Turning on microphone…',
    mic_denied: 'No access to microphone', mic_unavailable: 'Microphone not available',
    mic_https: 'Microphone only works over a secure (https) connection',
    mic_no_backchannel: 'This camera has no two-way audio in go2rtc',
    mic_remote: 'Talking needs a direct connection (at home or via VPN)',
    not_connected: 'Not connected yet', reconnecting: 'Reconnecting…',
    no_connection: 'No connection to camera, retrying…',
    recordings_unavailable: 'Recordings not available', playback_failed: 'Playback not possible',
    chime_on: 'Chime is on', chime_off: 'Chime is off', chime_failed: 'Changing chime failed',
    chime_on_label: 'Chime is on, tap to turn off', chime_off_label: 'Chime is off, tap to turn on',
    sound: 'Sound on/off', no_camera: 'Choose a Frigate camera in the card settings',
    not_frigate: 'This camera does not come from the Frigate integration',
  },
  nl: {
    live: 'LIVE', today: 'vandaag', yesterday: 'gisteren',
    talk_hold: 'Ingedrukt houden om te praten', talking: 'Je spreekt nu…', mic_on: 'Microfoon aanzetten…',
    mic_denied: 'Geen toegang tot microfoon', mic_unavailable: 'Microfoon niet beschikbaar',
    mic_https: 'Microfoon werkt alleen via een beveiligde (https) verbinding',
    mic_no_backchannel: 'Deze camera heeft geen terugspreekkanaal in go2rtc',
    mic_remote: 'Praten kan alleen met een directe verbinding (thuis of via VPN)',
    not_connected: 'Nog niet verbonden', reconnecting: 'Opnieuw verbinden…',
    no_connection: 'Geen verbinding met camera, opnieuw proberen…',
    recordings_unavailable: 'Opnames niet beschikbaar', playback_failed: 'Afspelen niet mogelijk',
    chime_on: 'Bel staat aan', chime_off: 'Bel staat uit', chime_failed: 'Bel aanpassen mislukt',
    chime_on_label: 'Bel staat aan, tik om uit te zetten', chime_off_label: 'Bel staat uit, tik om aan te zetten',
    sound: 'Geluid aan/uit', no_camera: 'Kies een Frigate-camera in de kaartinstellingen',
    not_frigate: 'Deze camera komt niet van de Frigate-integratie',
  },
};

const ICONS = {
  mic: 'M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3m7 9c0 3.53-2.61 6.44-6 6.93V21h-2v-3.07c-3.39-.49-6-3.4-6-6.93h2a5 5 0 0 0 10 0h2Z',
  soundOn: 'M14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.84-5 6.7v2.07c4-.91 7-4.49 7-8.77s-3-7.86-7-8.77M16.5 12c0-1.77-1-3.29-2.5-4.03V16c1.5-.71 2.5-2.24 2.5-4M3 9v6h4l5 5V4L7 9H3Z',
  soundOff: 'M12 4 9.91 6.09 12 8.18M4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.26c-.67.51-1.42.93-2.25 1.17v2.07a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9M19 12c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.9 8.9 0 0 0 21 12c0-4.28-3-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71m-2.5 0c0-1.77-1-3.29-2.5-4.03v2.21l2.45 2.45c.05-.2.05-.42.05-.63Z',
  bellOn: 'M21 19v1H3v-1l2-2v-6c0-3.1 2.03-5.83 5-6.71V4a2 2 0 0 1 4 0v.29c2.97.88 5 3.61 5 6.71v6l2 2m-7 2a2 2 0 0 1-4 0',
  bellOff: 'M20.84 22.73 18.11 20H3v-1l2-2v-6c0-1.14.29-2.27.83-3.28L1.11 3l1.28-1.27 19.72 19.73-1.27 1.27M19 15.8V11c0-3.1-2.03-5.83-5-6.71V4a2 2 0 0 0-4 0v.29c-.61.18-1.2.45-1.74.8L19 15.8M12 23a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2Z',
};
const svg = (path) => `<svg viewBox="0 0 24 24"><path d="${path}"/></svg>`;
const now = () => Date.now() / 1000;

// ---------- iOS sound unlock ----------
// iOS only plays video with sound if the element was started inside a tap. Cards in a popup
// are often created after the tap that opens the popup, so this module (loaded with the
// dashboard) keeps a small pool of video elements and unlocks them on the first tap anywhere.
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
const videoPool = [];
let poolUnlocked = false;

function newVideo() {
  const v = document.createElement('video');
  v.setAttribute('playsinline', '');
  v.playsInline = true;
  return v;
}

function unlockPool() {
  if (poolUnlocked) return;
  poolUnlocked = true;
  while (videoPool.length < 3) videoPool.push(newVideo());
  for (const v of videoPool) {
    v.muted = false;
    v.src = SILENT_WAV;
    const p = v.play();
    if (p) p.then(() => v.pause()).catch(() => { poolUnlocked = false; });
  }
}
['touchend', 'pointerup', 'click'].forEach((ev) => document.addEventListener(ev, unlockPool, true));

function takeVideo() {
  const v = videoPool.length ? videoPool.pop() : newVideo();
  v.removeAttribute('src');
  return v;
}

function returnVideo(v) {
  v.pause();
  v.srcObject = null;
  v.removeAttribute('src');
  v.onloadedmetadata = v.onresize = v.ontimeupdate = v.onended = null;
  if (v.parentNode) v.parentNode.removeChild(v);
  if (videoPool.length < 3) videoPool.push(v);
}

// Shared by all cards on the page: when the direct (WebRTC) connection failed recently, e.g. away
// from home without VPN, go straight to the stream via Home Assistant.
let webrtcBlockedUntil = 0;

let hlsLoading = null;
function loadHlsJs() {
  if (window.Hls) return Promise.resolve();
  if (!hlsLoading) {
    hlsLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = HLS_JS;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  return hlsLoading;
}

// ---------- Card ----------

const STYLE = `
  :host { display: block; }
  ha-card { overflow: hidden; background: #000; position: relative; }
  .stage { position: relative; width: 100%; aspect-ratio: var(--fdc-ratio, 4 / 3); background: #000; }
  video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: #000; }
  .msg { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    color: #fff; text-align: center; padding: 20px; box-sizing: border-box; font-size: 15px; }
  #status { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); padding: 4px 12px;
    border-radius: 12px; background: rgba(0,0,0,.55); color: #fff; font-size: 13px; opacity: 0;
    transition: opacity .2s; pointer-events: none; white-space: nowrap; max-width: 90%; overflow: hidden; text-overflow: ellipsis; }
  #status.show { opacity: 1; }
  #badge { position: absolute; top: 10px; left: 10px; padding: 3px 10px; border-radius: 12px;
    background: rgba(0,0,0,.55); color: #fff; font-size: 13px; font-weight: 600; pointer-events: none;
    font-variant-numeric: tabular-nums; }
  #badge.live::before { content: ''; display: inline-block; width: 8px; height: 8px; border-radius: 50%;
    background: #e53935; margin-right: 6px; vertical-align: 1px; }
  button, #talk { -webkit-tap-highlight-color: transparent; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
  #talk { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); width: 84px; height: 84px;
    border-radius: 50%; border: 2px solid rgba(255,255,255,.85); background: rgba(0,0,0,.55); color: #fff;
    display: grid; place-items: center; touch-action: none; cursor: pointer;
    transition: background .15s, transform .15s, box-shadow .15s; }
  #talk svg { width: 44px; height: 44px; fill: currentColor; pointer-events: none; }
  #talk.connecting { background: #fb8c00; }
  #talk.live { background: #e53935; border-color: #fff; transform: translateX(-50%) scale(1.12); animation: fdc-pulse 1.2s ease-out infinite; }
  @keyframes fdc-pulse { 0% { box-shadow: 0 0 0 0 rgba(229,57,53,.6); } 100% { box-shadow: 0 0 0 22px rgba(229,57,53,0); } }
  #golive { position: absolute; left: 50%; bottom: 22px; transform: translateX(-50%); display: none;
    padding: 12px 22px; border-radius: 26px; border: 2px solid rgba(255,255,255,.85); background: rgba(0,0,0,.6);
    color: #fff; font-size: 16px; font-weight: 600; cursor: pointer; }
  #golive::before { content: ''; display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #e53935; margin-right: 8px; }
  #micnote { position: absolute; left: 50%; bottom: 22px; transform: translateX(-50%); display: none; padding: 8px 14px;
    border-radius: 16px; background: rgba(0,0,0,.6); color: #fff; font-size: 13px; text-align: center; max-width: 55%; pointer-events: none; }
  .playback #talk, .nomic #talk { display: none; }
  .playback #golive { display: block; }
  .nomic:not(.playback) #micnote { display: block; }
  .round { position: absolute; bottom: 26px; width: 48px; height: 48px; border-radius: 50%; border: 0; color: #fff;
    display: grid; place-items: center; cursor: pointer; transition: background .2s, opacity .2s; }
  .round svg { width: 26px; height: 26px; fill: currentColor; pointer-events: none; }
  .round.on { background: rgba(3,169,244,.9); }
  .round.off { background: rgba(229,57,53,.9); }
  .round.busy { opacity: .5; }
  #sound { right: 12px; }
  #chime { right: 70px; display: none; }
  .tl { position: relative; height: ${TL_H}px; background: #141414; touch-action: none; cursor: grab; }
  .tl.dragging { cursor: grabbing; }
  .tl canvas { width: 100%; height: 100%; display: block; }
  .notimeline .tl { display: none; }
`;

class FrigateDoorbellCard extends HTMLElement {
  // ----- Lovelace API -----

  static getConfigElement() {
    return document.createElement('frigate-doorbell-card-editor');
  }

  static getStubConfig(hass) {
    const cam = Object.values(hass.states).find((s) => s.entity_id.startsWith('camera.')
      && s.attributes.camera_name && s.attributes.client_id);
    return { camera: cam ? cam.entity_id : '' };
  }

  setConfig(config) {
    if (!config || typeof config !== 'object') throw new Error('Invalid configuration');
    this._config = {
      timeline: true,
      microphone: true,
      history_days: 7,
      ...config,
    };
    if (this._built) this._applyConfig();
  }

  getCardSize() {
    return 6;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6 };
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (!this._built) this._build();
    if (first) this._applyConfig();
    this._renderChime();
  }

  // ----- Lifecycle -----

  connectedCallback() {
    if (!this._built) this._build();
    if (!this._video) {
      this._video = takeVideo();
      this._stage.prepend(this._video);
      this._bindVideo();
      this._renderSound();
    }
    if (!this._io) {
      this._io = new IntersectionObserver((entries) => {
        entries.forEach((en) => (en.isIntersecting && en.intersectionRatio > 0 ? this._start() : this._stop()));
      });
    }
    this._io.observe(this);
    this._ticker = setInterval(() => this._tick(), 1000);
    this._watchdog = setInterval(() => this._checkStall(), 2000);
    this._resizeObs = this._resizeObs || new ResizeObserver(() => this._draw());
    this._resizeObs.observe(this._tl);
  }

  disconnectedCallback() {
    this._stop();
    if (this._io) this._io.disconnect();
    if (this._resizeObs) this._resizeObs.disconnect();
    clearInterval(this._ticker);
    clearInterval(this._watchdog);
    if (this._video) { returnVideo(this._video); this._video = null; }
  }

  // ----- Setup -----

  _t(key) {
    const lang = (this._hass && ((this._hass.locale && this._hass.locale.language) || this._hass.language)) || 'en';
    const table = STRINGS[lang.split('-')[0]] || STRINGS.en;
    return table[key] || STRINGS.en[key] || key;
  }

  _build() {
    this._built = true;
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <ha-card>
        <div class="wrap">
          <div class="stage">
            <div class="msg" hidden></div>
            <div id="badge" class="live">LIVE</div>
            <div id="status"></div>
            <div id="talk" role="button">${svg(ICONS.mic)}</div>
            <button id="golive">LIVE</button>
            <div id="micnote"></div>
            <button id="chime" class="round on"></button>
            <button id="sound" class="round on"></button>
          </div>
          <div class="tl"><canvas></canvas></div>
        </div>
      </ha-card>`;
    const $ = (sel) => this.shadowRoot.querySelector(sel);
    this._wrap = $('.wrap');
    this._stage = $('.stage');
    this._msg = $('.msg');
    this._badge = $('#badge');
    this._statusEl = $('#status');
    this._talk = $('#talk');
    this._goLiveBtn = $('#golive');
    this._micNote = $('#micnote');
    this._chimeBtn = $('#chime');
    this._soundBtn = $('#sound');
    this._tl = $('.tl');
    this._canvas = this._tl.querySelector('canvas');
    this._ctx = this._canvas.getContext('2d');

    // State
    this._mode = 'live';
    this._active = false;
    this._wantSound = true;
    this._pc = null; this._ws = null; this._micSender = null; this._mic = null; this._micPending = null;
    this._holding = false; this._hasBackchannel = true;
    this._reconnectTimer = null; this._reconnectDelay = 2000; this._reconnecting = false;
    this._stall = { t: -1, at: 0, forced: false };
    this._hls = null; this._playback = null;
    this._centerTime = now(); this._pxPerSec = 0; this._loadedFrom = now();
    this._ranges = []; this._reviews = []; this._thumbs = new Map();
    this._loadingChunk = false; this._dragging = false; this._chimeBusy = false; this._chimeShown = null;

    this._bindControls();
    this._bindTimeline();
  }

  _applyConfig() {
    if (!this._hass || !this._config) return;
    const cfg = this._config;
    const st = cfg.camera && this._hass.states[cfg.camera];
    this._clientId = cfg.frigate_client_id || (st && st.attributes.client_id);
    this._camName = cfg.frigate_camera || (st && st.attributes.camera_name);
    this._history = Math.max(1, Number(cfg.history_days) || 7) * 86400;
    this._wrap.classList.toggle('notimeline', cfg.timeline === false);
    this._updateMicUi();
    this._talk.setAttribute('aria-label', this._t('talk_hold'));
    this._soundBtn.setAttribute('aria-label', this._t('sound'));
    this._goLiveBtn.textContent = this._t('live');
    if (!cfg.camera) return this._showMsg(this._t('no_camera'));
    if (!this._clientId || !this._camName) return this._showMsg(this._t('not_frigate'));
    this._showMsg('');
    this._chimeEntity = this._findChime();
    this._renderChime();
    this._renderSound();
  }

  // Microphone button only when it can work: enabled, secure context, and a go2rtc backchannel.
  _updateMicUi() {
    const cfg = this._config;
    const secure = window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
    const reason = cfg.microphone === false ? 'off' : !secure ? 'mic_https'
      : this._transport === 'mse' ? 'mic_remote' : !this._hasBackchannel ? 'mic_no_backchannel' : null;
    this._wrap.classList.toggle('nomic', !!reason);
    this._micNote.textContent = reason && reason !== 'off' ? this._t(reason) : '';
    this._micNote.style.visibility = reason === 'off' ? 'hidden' : '';
  }

  _showMsg(text) {
    this._msg.hidden = !text;
    this._msg.textContent = text || '';
  }

  _status(text, ms) {
    this._statusEl.textContent = text || '';
    this._statusEl.classList.toggle('show', !!text);
    clearTimeout(this._statusTimer);
    if (text && ms) this._statusTimer = setTimeout(() => this._status(''), ms);
  }

  _debug(...args) {
    if (this._config && this._config.debug) console.info('[frigate-doorbell-card]', ...args);
  }

  // ----- HA helpers -----

  async _signedUrl(path, expires = 3600) {
    const res = await this._hass.callWS({ type: 'auth/sign_path', path, expires });
    return this._hass.hassUrl(res.path);
  }

  async _frigateWS(msg) {
    const res = await this._hass.callWS({ instance_id: this._clientId, ...msg });
    return typeof res === 'string' ? JSON.parse(res) : res;
  }

  // ----- Start / stop -----

  _start() {
    if (this._active || !this._clientId || !this._camName || !this._video) return;
    this._active = true;
    this._loadedFrom = now();
    if (this._config.timeline !== false) {
      this._loadOlder();
      this._loadReviews();
      this._subscribeReviews();
    }
    this._goLive();
  }

  _stop() {
    this._gen = (this._gen || 0) + 1;
    if (!this._active) return;
    this._active = false;
    this._stopLive();
    this._detachHls();
    this._playback = null;
    this._setMode('live');
    if (this._video) { this._video.removeAttribute('src'); this._video.srcObject = null; }
    if (this._unsubReviews) { this._unsubReviews.then((u) => u && u()).catch(() => {}); this._unsubReviews = null; }
  }

  _setMode(mode) {
    this._mode = mode;
    this._wrap.classList.toggle('playback', mode === 'playback');
    this._updateBadge();
  }

  // ----- Live (WebRTC via the Frigate integration's go2rtc proxy) -----

  // The send-only audio track for your voice is negotiated right away without a microphone;
  // pressing the button only puts the mic in (replaceTrack): instant, no reconnect.
  async _connect() {
    if (Date.now() < webrtcBlockedUntil) return this._connectMse();
    return this._connectWebRTC();
  }

  // The direct connection didn't come up (e.g. away from home without VPN, port 8555 not reachable):
  // remember that for a while and switch to the stream via Home Assistant.
  _webrtcFailed(conn) {
    if (conn !== this._pc || !this._active || this._mode !== 'live') return;
    this._debug('direct connection failed, switching to stream via Home Assistant');
    webrtcBlockedUntil = Date.now() + WEBRTC_RETRY_AFTER;
    this._connectMse().catch((err) => {
      this._debug('mse failed', err);
      this._reconnectDelay = Math.min(this._reconnectDelay * 2, 30000);
      this._scheduleReconnect(this._reconnectDelay);
    });
  }

  async _connectWebRTC() {
    this._closeConnection();
    this._transport = 'webrtc';
    const gen = this._gen;
    let everConnected = false;
    // Stopped (card hidden/removed) or replaced by a newer attempt while awaiting: clean up.
    const stale = () => gen !== this._gen || conn !== this._pc;
    const conn = new RTCPeerConnection({ bundlePolicy: 'max-bundle' });
    this._pc = conn;
    const stream = new MediaStream();
    conn.ontrack = (e) => stream.addTrack(e.track);
    conn.addTransceiver('video', { direction: 'recvonly' });
    conn.addTransceiver('audio', { direction: 'recvonly' });
    this._micSender = conn.addTransceiver('audio', { direction: 'sendonly' }).sender;
    if (this._mic && this._holding) this._micSender.replaceTrack(this._mic.getAudioTracks()[0]).catch(() => {});
    conn.onconnectionstatechange = () => {
      if (conn !== this._pc) return;
      const st = conn.connectionState;
      if (st === 'connected') {
        everConnected = true;
        clearTimeout(this._webrtcTimer);
        this._reconnectDelay = 2000;
        clearTimeout(this._reconnectTimer);
        if (this._reconnecting) { this._reconnecting = false; this._status(''); }
      } else if (st === 'failed') {
        if (!everConnected) this._webrtcFailed(conn);
        else this._scheduleReconnect(0);
      } else if (st === 'disconnected') {
        this._scheduleReconnect(4000);
      }
    };

    const url = (await this._signedUrl(
      `/api/frigate/${this._clientId}/webrtc/api/ws?src=${encodeURIComponent(this._camName)}`, 60,
    )).replace(/^http/, 'ws');
    if (stale()) { conn.close(); return; }
    const ws = new WebSocket(url);
    this._ws = ws;
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error('websocket'));
    });
    const answer = new Promise((resolve, reject) => {
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (msg.type === 'webrtc/answer') resolve(msg.value);
        else if (msg.type === 'webrtc/candidate') {
          conn.addIceCandidate({ candidate: msg.value, sdpMid: '0' }).catch(() => {});
        } else if (msg.type === 'error') reject(new Error(msg.value));
      };
      ws.onclose = () => {
        reject(new Error('websocket closed'));
        // The go2rtc consumer lives as long as this websocket: if it closes, reconnect.
        if (ws === this._ws && conn === this._pc) this._scheduleReconnect(2000);
      };
    });
    conn.onicecandidate = (e) => {
      if (e.candidate && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'webrtc/candidate', value: e.candidate.candidate }));
      }
    };
    await conn.setLocalDescription(await conn.createOffer());
    ws.send(JSON.stringify({ type: 'webrtc/offer', value: conn.localDescription.sdp }));
    const sdp = await answer;
    if (stale()) { try { ws.close(); } catch (e) {} conn.close(); return; }
    await conn.setRemoteDescription({ type: 'answer', sdp });
    clearTimeout(this._webrtcTimer);
    this._webrtcTimer = setTimeout(() => { if (!everConnected) this._webrtcFailed(conn); }, WEBRTC_TIMEOUT);
    this._hasBackchannel = this._answerHasBackchannel(sdp);
    this._debug('connected, backchannel:', this._hasBackchannel);
    this._updateMicUi();
    if (stale() || this._mode !== 'live' || !this._video) return;
    this._detachHls();
    this._video.removeAttribute('src');
    this._video.srcObject = stream;
    this._liveAttached = true;
    this._stall.at = Date.now();
    await this._playWithSound();
  }

  // Fallback: go2rtc's MSE stream (fragmented MP4 over a websocket) through the Frigate integration.
  // Works wherever Home Assistant works; a bit more delay and no talking (that needs WebRTC).
  async _connectMse() {
    this._closeConnection();
    this._transport = 'mse';
    this._updateMicUi();
    const gen = this._gen;
    const MS = window.ManagedMediaSource || window.MediaSource;
    if (!MS) throw new Error('no MediaSource');
    const url = (await this._signedUrl(
      `/api/frigate/${this._clientId}/mse/api/ws?src=${encodeURIComponent(this._camName)}`, 60,
    )).replace(/^http/, 'ws');
    if (gen !== this._gen || this._mode !== 'live' || !this._video) return;
    const v = this._video;
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    this._ws = ws;
    const ms = new MS();
    this._ms = ms;
    v.srcObject = null;
    if (window.ManagedMediaSource && MS === window.ManagedMediaSource) {
      v.disableRemotePlayback = true;
      v.srcObject = ms;
    } else {
      this._msUrl = URL.createObjectURL(ms);
      v.src = this._msUrl;
    }
    await Promise.all([
      new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('websocket')); }),
      new Promise((resolve) => ms.addEventListener('sourceopen', resolve, { once: true })),
    ]);
    if (ws !== this._ws) return;
    const codecs = MSE_CODECS.filter((c) => MS.isTypeSupported(`video/mp4; codecs="${c}"`)).join();
    ws.send(JSON.stringify({ type: 'mse', value: codecs }));

    let sb = null;
    let queue = [];
    const pump = () => {
      if (!sb || sb.updating || !queue.length || ms.readyState !== 'open') return;
      try { sb.appendBuffer(queue.shift()); } catch (e) { queue = []; }
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (msg.type === 'mse' && !sb) {
          sb = ms.addSourceBuffer(msg.value);
          sb.mode = 'segments';
          sb.addEventListener('updateend', () => {
            // Stay close to live and keep the buffer small.
            if (!sb.updating && sb.buffered.length) {
              const end = sb.buffered.end(sb.buffered.length - 1);
              const start = sb.buffered.start(0);
              if (end - start > 15) { try { sb.remove(start, end - 10); return; } catch (e) {} }
              if (end - v.currentTime > 3) v.currentTime = end - 0.5;
            }
            pump();
          });
          this._liveAttached = true;
          this._stall.at = Date.now();
          this._playWithSound();
        } else if (msg.type === 'error') {
          this._debug('mse error', msg.value);
        }
      } else {
        queue.push(ev.data);
        pump();
      }
    };
    ws.onclose = () => {
      if (ws === this._ws) this._scheduleReconnect(2000);
    };
    this._debug('streaming via Home Assistant (mse), codecs:', codecs);
    if (this._reconnecting) { this._reconnecting = false; this._status(''); }
  }

  // go2rtc only accepts our send-only audio section if the stream has a backchannel source.
  _answerHasBackchannel(sdp) {
    const sections = sdp.split(/\r?\nm=/).slice(1);
    const audio = sections.filter((s) => s.startsWith('audio'));
    const ours = audio[1];
    if (!ours) return false;
    return !/\ba=inactive\b/.test(ours) && !/^audio 0 /.test(ours);
  }

  _closeConnection() {
    clearTimeout(this._webrtcTimer);
    this._liveAttached = false;
    if (this._ws) { const ws = this._ws; this._ws = null; ws.onclose = null; try { ws.close(); } catch (e) {} }
    if (this._ms) { this._ms = null; }
    if (this._msUrl) { URL.revokeObjectURL(this._msUrl); this._msUrl = null; }
    if (this._pc) { const pc = this._pc; this._pc = null; pc.onconnectionstatechange = null; pc.close(); }
    this._micSender = null;
  }

  _scheduleReconnect(delay) {
    if (!this._active || this._mode !== 'live') return;
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(async () => {
      if (!this._active || this._mode !== 'live') return;
      if (this._pc && this._pc.connectionState === 'connected' && delay > 0 && !this._stall.forced) return;
      this._stall.forced = false;
      this._reconnecting = true;
      this._status(this._t('reconnecting'));
      this._debug('reconnect', delay);
      try {
        await this._connect();
      } catch (err) {
        this._reconnectDelay = Math.min(this._reconnectDelay * 2, 30000);
        this._scheduleReconnect(this._reconnectDelay);
      }
    }, delay);
  }

  // Watchdog: "connected" but the picture is frozen (camera or go2rtc restarted) → reconnect.
  _checkStall() {
    const v = this._video;
    if (!this._active || this._mode !== 'live' || !v || !this._liveAttached || v.paused) { this._stall.at = Date.now(); return; }
    if (v.currentTime !== this._stall.t) { this._stall.t = v.currentTime; this._stall.at = Date.now(); return; }
    if (Date.now() - this._stall.at > 8000) {
      this._stall.at = Date.now();
      this._stall.forced = true;
      this._scheduleReconnect(0);
    }
  }

  async _playWithSound() {
    const v = this._video;
    v.muted = !this._wantSound;
    try { await v.play(); }
    catch (e) {
      // Autoplay with sound blocked: start muted, the speaker button turns sound on.
      v.muted = true;
      try { await v.play(); } catch (e2) {}
    }
    this._renderSound();
  }

  _stopLive() {
    this._pressEnd();
    clearTimeout(this._reconnectTimer);
    this._reconnecting = false;
    this._closeConnection();
    if (this._mic) { this._mic.getTracks().forEach((t) => t.stop()); this._mic = null; }
  }

  _goLive() {
    this._playback = null;
    this._setMode('live');
    this._detachHls();
    this._video.removeAttribute('src');
    this._video.srcObject = null;
    this._centerTime = now();
    this._draw();
    this._connect().catch((err) => {
      this._debug('connect failed', err);
      this._status(this._t('no_connection'));
      this._reconnectDelay = Math.min(this._reconnectDelay * 2, 30000);
      this._scheduleReconnect(this._reconnectDelay);
    });
  }

  // ----- Push-to-talk -----

  _setMicEnabled(on) {
    if (!this._mic) return;
    const track = this._mic.getAudioTracks()[0];
    track.enabled = on;
    // After releasing, send nothing at all to the doorbell (not even silence).
    if (this._micSender) this._micSender.replaceTrack(on ? track : null).catch(() => {});
  }

  _micLive() {
    return this._mic && this._mic.getAudioTracks().some((t) => t.readyState === 'live');
  }

  async _pressStart(e) {
    e.preventDefault();
    if (this._talk.setPointerCapture && e.pointerId !== undefined) this._talk.setPointerCapture(e.pointerId);
    this._holding = true;
    if (!this._micLive()) {
      this._talk.className = 'connecting';
      this._status(this._t('mic_on'));
      try {
        if (!this._micPending) {
          this._micPending = navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          }).finally(() => (this._micPending = null));
        }
        this._mic = await this._micPending;
        this._mic.getAudioTracks().forEach((t) => (t.enabled = false));
      } catch (err) {
        this._talk.className = '';
        this._status(this._t(err.name === 'NotAllowedError' ? 'mic_denied' : 'mic_unavailable'), 3000);
        return;
      }
    }
    if (!this._holding) { this._talk.className = ''; this._status(''); return; }
    if (!this._micSender) { this._talk.className = ''; this._status(this._t('not_connected'), 2000); return; }
    this._setMicEnabled(true);
    this._talk.className = 'live';
    this._status(this._t('talking'));
  }

  _pressEnd(e) {
    if (e) e.preventDefault();
    const wasHolding = this._holding;
    this._holding = false;
    this._setMicEnabled(false);
    if (!this._micPending && wasHolding) { this._talk.className = ''; if (!this._reconnecting) this._status(''); }
  }

  // ----- Buttons -----

  _bindControls() {
    this._talk.addEventListener('pointerdown', (e) => this._pressStart(e));
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => this._talk.addEventListener(ev, (e) => this._pressEnd(e)));
    this._talk.addEventListener('contextmenu', (e) => e.preventDefault());
    this._soundBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const v = this._video;
      this._wantSound = v.muted;
      v.muted = !this._wantSound;
      v.play().catch(() => {});
      this._renderSound();
    });
    this._goLiveBtn.addEventListener('click', (e) => { e.stopPropagation(); this._goLive(); });
    this._chimeBtn.addEventListener('click', (e) => { e.stopPropagation(); this._toggleChime(); });
    // Tap on the picture during playback = pause/resume.
    this._stage.addEventListener('click', (e) => {
      if (this._mode !== 'playback' || e.composedPath().some((el) => el.tagName === 'BUTTON' || el === this._talk)) return;
      if (this._video.paused) this._video.play().catch(() => {}); else this._video.pause();
    });
  }

  _renderSound() {
    if (!this._video) return;
    const muted = this._video.muted;
    this._soundBtn.innerHTML = svg(muted ? ICONS.soundOff : ICONS.soundOn);
    this._soundBtn.className = 'round ' + (muted ? 'off' : 'on');
  }

  // ----- Chime -----

  _findChime() {
    const cfg = this._config;
    if (cfg.chime === false || cfg.chime === '' || cfg.chime === null) return null;
    if (cfg.chime) return cfg.chime;
    // Auto-detect: exactly one number entity that looks like a chime volume.
    const found = Object.keys(this._hass.states).filter((id) => /^number\..*chime.*volume/.test(id));
    return found.length === 1 ? found[0] : null;
  }

  _renderChime() {
    if (!this._built || !this._hass) return;
    const st = this._chimeEntity && this._hass.states[this._chimeEntity];
    if (!st || st.state === 'unavailable' || st.state === 'unknown') { this._chimeBtn.style.display = 'none'; return; }
    this._chimeBtn.style.display = 'grid';
    const on = Number(st.state) > 0;
    if (this._chimeShown === on) return;
    this._chimeShown = on;
    this._chimeBtn.className = 'round ' + (on ? 'on' : 'off');
    this._chimeBtn.innerHTML = svg(on ? ICONS.bellOn : ICONS.bellOff);
    this._chimeBtn.setAttribute('aria-label', this._t(on ? 'chime_on_label' : 'chime_off_label'));
    this._chimeBtn.title = this._t(on ? 'chime_on' : 'chime_off');
  }

  async _toggleChime() {
    const st = this._chimeEntity && this._hass.states[this._chimeEntity];
    if (!st || this._chimeBusy) return;
    const on = Number(st.state) > 0;
    const onVolume = Number(this._config.chime_volume) || Number(st.attributes.max) || 4;
    this._chimeBusy = true;
    this._chimeBtn.classList.add('busy');
    try {
      await this._hass.callService('number', 'set_value', { entity_id: this._chimeEntity, value: on ? 0 : onVolume });
      this._status(this._t(on ? 'chime_off' : 'chime_on'), 2000);
    } catch (err) {
      this._status(this._t('chime_failed'), 2000);
    }
    this._chimeBusy = false;
    this._chimeBtn.classList.remove('busy');
  }

  // ----- Video element -----

  _bindVideo() {
    const v = this._video;
    v.onloadedmetadata = v.onresize = () => {
      if (v.videoWidth && v.videoHeight) this.style.setProperty('--fdc-ratio', `${v.videoWidth} / ${v.videoHeight}`);
    };
    v.ontimeupdate = () => {
      if (this._mode !== 'playback' || !this._playback || this._dragging) return;
      this._centerTime = this._wallTime(v.currentTime);
      this._updateBadge();
      this._draw();
    };
    v.onended = () => {
      if (this._mode !== 'playback' || !this._playback) return;
      this._playFrom(this._playback.vodEnd + 1);
    };
  }

  // ----- Playback (Frigate VOD via the integration) -----

  _detachHls() {
    if (this._hls) { this._hls.destroy(); this._hls = null; }
  }

  async _playFrom(t) {
    if (now() - t < LIVE_EDGE) return this._goLive();
    const start = Math.floor(t);
    const end = Math.min(Math.floor(now()), start + 3600);
    let segs;
    try {
      segs = (await this._frigateWS({ type: 'frigate/recordings/get', camera: this._camName, after: start - 15, before: end }))
        .filter((s) => s.end_time > start && s.start_time < end)
        .sort((a, b) => a.start_time - b.start_time);
    } catch (e) { this._status(this._t('recordings_unavailable'), 3000); return; }
    if (!segs.length) return this._goLive();

    // Frigate concatenates segments in the VOD (gaps are dropped) and trims the first one at
    // `start`: keep a media-time → wall-time table so the timeline follows playback.
    let media = 0;
    const map = segs.map((s) => {
      const from = Math.max(s.start_time, start), to = Math.min(s.end_time, end);
      const m = { start: from, end: to, mediaStart: media };
      media += to - from;
      return m;
    });

    this._stopLive();
    this._playback = { segs: map, vodEnd: end };
    this._setMode('playback');
    this._centerTime = map[0].start;
    this._draw();

    // index.m3u8 (not master): the signature on it is passed on to every segment.
    let url;
    try {
      url = await this._signedUrl(`/api/frigate/${this._clientId}/vod/${encodeURIComponent(this._camName)}/start/${start}/end/${end}/index.m3u8`);
    } catch (e) { this._status(this._t('recordings_unavailable'), 3000); return; }
    if (this._mode !== 'playback') return;
    const v = this._video;
    v.srcObject = null;
    this._detachHls();
    // Safari/iOS: native HLS works well. Elsewhere hls.js: Chrome's new native HLS player stalls
    // and pauses at Frigate's segment boundaries.
    const apple = /Apple/.test(navigator.vendor || '');
    if (apple && v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = url;
    } else {
      try { await loadHlsJs(); } catch (e) { this._status(this._t('playback_failed'), 3000); return; }
      if (this._mode !== 'playback') return;
      this._hls = new window.Hls({ maxBufferLength: 20 });
      this._hls.loadSource(url);
      this._hls.attachMedia(v);
    }
    await this._playWithSound();
  }

  _wallTime(mediaT) {
    if (!this._playback) return now();
    const segs = this._playback.segs;
    for (const s of segs) {
      if (mediaT < s.mediaStart + (s.end - s.start)) return s.start + Math.max(0, mediaT - s.mediaStart);
    }
    return segs[segs.length - 1].end;
  }

  _fmtTime(t, withDate) {
    const locale = (this._hass && this._hass.locale && this._hass.locale.language) || undefined;
    const d = new Date(t * 1000);
    const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (!withDate) return time;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const day = new Date(d); day.setHours(0, 0, 0, 0);
    const diff = Math.round((today - day) / 86400000);
    const label = diff === 0 ? this._t('today') : diff === 1 ? this._t('yesterday')
      : d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
    return label + ' ' + time;
  }

  _updateBadge() {
    if (this._mode === 'live' && !this._dragging) { this._badge.className = 'live'; this._badge.textContent = this._t('live'); return; }
    this._badge.className = '';
    this._badge.textContent = this._fmtTime(this._centerTime, true);
  }

  // ----- Timeline data -----

  _mergeSegments(segs) {
    const bySecond = new Map(this._ranges.map((r) => [Math.round(r.start), r]));
    segs.forEach((s) => bySecond.set(Math.round(s.start_time), { start: s.start_time, end: s.end_time, motion: s.motion || 0 }));
    this._ranges = [...bySecond.values()].sort((a, b) => a.start - b.start);
  }

  async _loadChunk(from, to) {
    this._mergeSegments(await this._frigateWS({ type: 'frigate/recordings/get', camera: this._camName, after: Math.floor(from), before: Math.ceil(to) }));
    this._draw();
  }

  async _loadOlder() {
    if (this._loadingChunk || this._loadedFrom <= now() - this._history) return;
    this._loadingChunk = true;
    const to = this._loadedFrom, from = Math.max(now() - this._history, to - CHUNK);
    try { await this._loadChunk(from, to); this._loadedFrom = from; } catch (e) { this._debug('recordings', e); }
    finally { this._loadingChunk = false; }
  }

  async _loadReviews() {
    const t = now();
    try {
      this._reviews = (await this._frigateWS({
        type: 'frigate/reviews/get', cameras: [this._camName],
        after: Math.floor(t - this._history), before: Math.ceil(t), limit: 1000,
      })).sort((a, b) => a.start_time - b.start_time);
    } catch (e) { this._debug('reviews', e); return; }
    for (const r of this._reviews) {
      if (this._thumbs.has(r.id) || !r.thumb_path) continue;
      const img = new Image();
      img.onload = () => this._draw();
      this._thumbs.set(r.id, img);
      const path = `/api/frigate/${this._clientId}/clips/${r.thumb_path.replace(/^\/media\/frigate\/clips\//, '')}`;
      this._signedUrl(path, 86400).then((u) => (img.src = u)).catch(() => {});
    }
    this._draw();
  }

  // New/updated review items arrive via the integration (Frigate → MQTT → HA); refresh shortly after.
  _subscribeReviews() {
    if (this._unsubReviews) return;
    this._unsubReviews = this._hass.connection.subscribeMessage((raw) => {
      let msg = raw;
      try { if (typeof raw === 'string') msg = JSON.parse(raw); } catch (e) { return; }
      const cam = msg && (msg.after || msg.before || {}).camera;
      if (cam && cam !== this._camName) return;
      clearTimeout(this._reviewTimer);
      this._reviewTimer = setTimeout(() => {
        this._loadReviews();
        const t = now();
        this._loadChunk(t - 900, t).catch(() => {});
      }, 1500);
    }, { type: 'frigate/reviews/subscribe', instance_id: this._clientId }).catch((e) => { this._debug('subscribe', e); return null; });
  }

  _tick() {
    if (!this._active) return;
    if (this._mode === 'live' && !this._dragging) this._centerTime = now();
    this._draw();
    // Fallback refresh of recent recordings every minute.
    if (!this._lastRefresh || Date.now() - this._lastRefresh > 60000) {
      this._lastRefresh = Date.now();
      if (this._config.timeline !== false && this._ranges.length) {
        const t = now();
        this._loadChunk(t - 900, t).catch(() => {});
      }
    }
  }

  // ----- Timeline drawing -----

  _resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const w = this._tl.clientWidth, h = this._tl.clientHeight;
    if (this._canvas.width !== Math.round(w * dpr) || this._canvas.height !== Math.round(h * dpr)) {
      this._canvas.width = Math.round(w * dpr);
      this._canvas.height = Math.round(h * dpr);
    }
    this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!this._pxPerSec && w) this._pxPerSec = w / 3600;
    return [w, h];
  }

  _draw() {
    if (!this._built || !this._config || this._config.timeline === false) return;
    const ctx = this._ctx;
    const [w, h] = this._resizeCanvas();
    if (!w || !h) return;
    const pps = this._pxPerSec, center = this._centerTime;
    const t0 = center - w / 2 / pps, t1 = center + w / 2 / pps;
    const x = (t) => (t - center) * pps + w / 2;
    const tNow = now();
    const locale = (this._hass && this._hass.locale && this._hass.locale.language) || undefined;
    ctx.clearRect(0, 0, w, h);

    if (x(tNow) < w) { ctx.fillStyle = '#0a0a0a'; ctx.fillRect(Math.max(0, x(tNow)), 0, w, h); }

    // Time axis.
    const step = TICKS.find((s) => s * pps >= 70) || 86400;
    ctx.font = '11px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const tzOffset = new Date().getTimezoneOffset() * 60;
    for (let t = Math.ceil((t0 - tzOffset) / step) * step + tzOffset; t <= t1; t += step) {
      const d = new Date(t * 1000);
      const label = d.getHours() === 0 && d.getMinutes() === 0
        ? d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric' })
        : d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
      ctx.fillStyle = '#9e9e9e';
      ctx.fillText(label, x(t), 3);
      ctx.fillStyle = '#333';
      ctx.fillRect(Math.round(x(t)), 16, 1, h - 16);
    }

    // Recordings (grey) with motion (orange).
    const barY = h - 22, barH = 16;
    ctx.fillStyle = '#262626';
    ctx.fillRect(0, barY, Math.min(w, x(tNow)), barH);
    for (const r of this._ranges) {
      if (r.end < t0 || r.start > t1) continue;
      const a = x(r.start), b = Math.max(x(r.end), a + 1);
      ctx.fillStyle = '#5c5c5c';
      ctx.fillRect(a, barY, b - a, barH);
      if (r.motion > 0) {
        ctx.fillStyle = `rgba(251,140,0,${Math.min(1, 0.35 + r.motion / 60)})`;
        ctx.fillRect(a, barY + barH - 6, b - a, 6);
      }
    }

    // Review items: coloured strip + thumbnail above.
    const thumbH = 36, thumbW = 48, thumbY = 18;
    let lastThumbX = -Infinity;
    for (const r of this._reviews) {
      const end = r.end_time || tNow;
      if (end < t0 || r.start_time > t1) continue;
      const color = r.severity === 'alert' ? '#e53935' : '#fdd835';
      const a = x(r.start_time), b = Math.max(x(end), a + 3);
      ctx.fillStyle = color;
      ctx.fillRect(a, barY, b - a, 4);
      if (a - lastThumbX < thumbW + 4) continue;
      lastThumbX = a;
      const img = this._thumbs.get(r.id);
      ctx.save();
      this._roundRect(a, thumbY, thumbW, thumbH, 5);
      ctx.clip();
      if (img && img.complete && img.naturalWidth) {
        const s = Math.max(thumbW / img.naturalWidth, thumbH / img.naturalHeight);
        const iw = img.naturalWidth * s, ih = img.naturalHeight * s;
        ctx.drawImage(img, a + (thumbW - iw) / 2, thumbY + (thumbH - ih) / 2, iw, ih);
      } else {
        ctx.fillStyle = '#333';
        ctx.fillRect(a, thumbY, thumbW, thumbH);
      }
      ctx.restore();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      this._roundRect(a, thumbY, thumbW, thumbH, 5);
      ctx.stroke();
    }

    // Playhead (centre).
    ctx.fillStyle = this._mode === 'live' && !this._dragging ? '#e53935' : '#fff';
    ctx.fillRect(Math.round(w / 2) - 1, 14, 2, h - 14);
    ctx.beginPath();
    ctx.moveTo(w / 2 - 6, 14); ctx.lineTo(w / 2 + 6, 14); ctx.lineTo(w / 2, 21); ctx.closePath();
    ctx.fill();

    if (this._active && t0 < this._loadedFrom + 600) this._loadOlder();
  }

  _roundRect(x, y, w, h, r) {
    const ctx = this._ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  _clampTime(t) {
    return Math.min(now(), Math.max(now() - this._history, t));
  }

  // ----- Timeline interaction: drag = scrub, tap = jump (or to the review item), pinch/wheel = zoom -----

  _bindTimeline() {
    const tl = this._tl;
    const pointers = new Map();
    let dragStartX = 0, dragStartTime = 0, moved = 0, pinchStart = null;

    tl.addEventListener('pointerdown', (e) => {
      tl.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, e.clientX);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchStart = { dist: Math.abs(a - b) || 1, pps: this._pxPerSec };
        return;
      }
      this._dragging = true;
      tl.classList.add('dragging');
      dragStartX = e.clientX;
      dragStartTime = this._centerTime;
      moved = 0;
    });

    tl.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, e.clientX);
      if (pointers.size === 2 && pinchStart) {
        const [a, b] = [...pointers.values()];
        this._setZoom(pinchStart.pps * (Math.abs(a - b) || 1) / pinchStart.dist);
        return;
      }
      if (!this._dragging) return;
      const dx = e.clientX - dragStartX;
      moved = Math.max(moved, Math.abs(dx));
      this._centerTime = this._clampTime(dragStartTime - dx / this._pxPerSec);
      this._updateBadge();
      this._draw();
    });

    const endPointer = (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (pinchStart) {
        if (pointers.size === 0) { pinchStart = null; this._dragging = false; tl.classList.remove('dragging'); }
        return;
      }
      if (!this._dragging) return;
      this._dragging = false;
      tl.classList.remove('dragging');
      let target = this._centerTime;
      if (moved < 6) {
        const rect = tl.getBoundingClientRect();
        const tapX = e.clientX - rect.left;
        target = this._clampTime(this._centerTime + (tapX - rect.width / 2) / this._pxPerSec);
        const hit = this._reviews.find((r) => {
          const a = (r.start_time - this._centerTime) * this._pxPerSec + rect.width / 2;
          return tapX >= a - 4 && tapX <= a + 52;
        });
        if (hit) target = hit.start_time - 3;
      }
      this._centerTime = target;
      this._updateBadge();
      this._draw();
      this._playFrom(target);
    };
    ['pointerup', 'pointercancel'].forEach((ev) => tl.addEventListener(ev, endPointer));

    tl.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        this._setZoom(this._pxPerSec * Math.exp(-e.deltaY * 0.01));
      } else {
        this._centerTime = this._clampTime(this._centerTime + e.deltaX / this._pxPerSec);
        this._draw();
        clearTimeout(this._wheelTimer);
        this._wheelTimer = setTimeout(() => this._playFrom(this._centerTime), 400);
      }
    }, { passive: false });
  }

  _setZoom(pps) {
    const w = this._tl.clientWidth || 1;
    this._pxPerSec = Math.min(w / 300, Math.max(w / 86400, pps));   // between 5 min and 24 h visible
    this._draw();
  }
}

// ---------- Visual editor ----------

class FrigateDoorbellCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  _render() {
    if (!this._hass || !this._config) return;
    if (!this._form) {
      this._form = document.createElement('ha-form');
      this._form.computeLabel = (s) => ({
        camera: 'Camera (Frigate)', chime: 'Chime (number entity, optional)', chime_volume: 'Chime volume when on',
        history_days: 'Timeline history (days)', timeline: 'Show timeline', microphone: 'Show microphone button',
      })[s.name] || s.name;
      this._form.addEventListener('value-changed', (ev) => {
        const config = { ...ev.detail.value };
        Object.keys(config).forEach((k) => (config[k] === '' || config[k] === undefined) && delete config[k]);
        this.dispatchEvent(new CustomEvent('config-changed', { detail: { config }, bubbles: true, composed: true }));
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.data = { timeline: true, microphone: true, history_days: 7, ...this._config };
    this._form.schema = [
      { name: 'camera', required: true, selector: { entity: { filter: { domain: 'camera', integration: 'frigate' } } } },
      { name: 'chime', selector: { entity: { filter: { domain: 'number' } } } },
      { name: 'chime_volume', selector: { number: { min: 1, max: 100, mode: 'box' } } },
      { name: 'history_days', selector: { number: { min: 1, max: 30, mode: 'box' } } },
      { name: 'timeline', selector: { boolean: {} } },
      { name: 'microphone', selector: { boolean: {} } },
    ];
  }
}

customElements.define('frigate-doorbell-card', FrigateDoorbellCard);
customElements.define('frigate-doorbell-card-editor', FrigateDoorbellCardEditor);
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'frigate-doorbell-card',
  name: 'Frigate Doorbell Card',
  description: 'Live view with push-to-talk, a scrubbable timeline with Frigate recordings and a chime button.',
  preview: false,
  documentationURL: 'https://github.com/versluis-org/frigate-doorbell-card',
});
console.info(`%c FRIGATE-DOORBELL-CARD %c ${CARD_VERSION} `, 'background:#03a9f4;color:#fff;font-weight:bold', 'background:#333;color:#fff');
