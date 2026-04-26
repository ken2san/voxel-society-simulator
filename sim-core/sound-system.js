/**
 * sim-core/sound-system.js
 *
 * Lightweight synthesized sound system – no audio files, no loading.
 * All sounds are generated via Web Audio API on the audio thread.
 *
 * Gate: window.soundEnabled === true
 * Per-sound throttle: avoids spam when many characters trigger the same
 * event in the same frame (dig/build/eat etc.).
 *
 * Usage:
 *   import { playSound } from './sim-core/sound-system.js';
 *   playSound('dig');
 *   playSound('build');
 *   playSound('eat');
 *   playSound('social');
 *   playSound('death');
 *   playSound('night');   // dusk transition
 *   playSound('dawn');    // dawn transition
 */

let _ctx = null;
let _masterGain = null;

/** Lazy-init AudioContext (must be after first user gesture on Chrome) */
function _getCtx() {
    if (_ctx) return _ctx;
    try {
        _ctx = new (window.AudioContext || window.webkitAudioContext)();
        _masterGain = _ctx.createGain();
        _masterGain.gain.value = _getVolume();
        _masterGain.connect(_ctx.destination);
    } catch (_) {
        _ctx = null;
    }
    return _ctx;
}

/** Read current volume from window.soundVolume (0-1), default 0.65 */
function _getVolume() {
    const v = (typeof window !== 'undefined' && window.soundVolume !== undefined)
        ? Number(window.soundVolume) : 0.65;
    return Math.max(0, Math.min(1, v));
}

/** Called by sidebar slider to update master gain in real time */
export function setSoundVolume(v) {
    if (typeof window !== 'undefined') window.soundVolume = v;
    if (_masterGain) _masterGain.gain.value = Math.max(0, Math.min(1, v));
}

// Per-sound cooldown map (ms timestamps of last play)
const _lastPlay = {};
const THROTTLE = {
    dig:        600,   // global rate-limit: max ~1.7x/sec regardless of how many chars are digging
    build:      200,
    eat:        300,
    social:     400,
    death:      600,
    night:      0,
    dawn:       0,
    enter_home: 600,
    leave_home: 600,
    thunder:    8000,   // max one crack per 8 s globally
};

/**
 * Play a named synthesized sound.
 * @param {string} name  one of: dig | build | eat | social | death | night | dawn
 */
export function playSound(name) {
    if (typeof window === 'undefined' || window.soundEnabled !== true) return;
    const ctx = _getCtx();
    if (!ctx) return;

    // Resume if suspended (browser autoplay policy)
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const now = performance.now();
    const throttleMs = THROTTLE[name] ?? 150;
    if (throttleMs > 0 && _lastPlay[name] && (now - _lastPlay[name]) < throttleMs) return;
    _lastPlay[name] = now;

    switch (name) {
        case 'dig':    _playDig(ctx);    break;
        case 'build':  _playBuild(ctx);  break;
        case 'eat':    _playEat(ctx);    break;
        case 'social': _playSocial(ctx); break;
        case 'death':  _playDeath(ctx);  break;
        case 'night':      _playNight(ctx);     break;
        case 'dawn':       _playDawn(ctx);      break;
        case 'enter_home': _playEnterHome(ctx); break;
        case 'leave_home': _playLeaveHome(ctx); break;
        case 'thunder':    _playThunder(ctx, Math.random()); break;
        default: break;
    }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function _osc(ctx, type, freq, startT, endT, gainVal, freqEnd = null) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(gainVal, startT);
    g.gain.exponentialRampToValueAtTime(0.0001, endT);
    g.connect(_masterGain);

    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, startT);
    if (freqEnd !== null) o.frequency.exponentialRampToValueAtTime(freqEnd, endT);
    o.connect(g);
    o.start(startT);
    o.stop(endT + 0.01);
}

function _noise(ctx, startT, duration, gainVal, filterFreq = 800) {
    const bufLen = ctx.sampleRate * duration;
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterFreq;
    filter.Q.value = 1.5;

    const g = ctx.createGain();
    g.gain.setValueAtTime(gainVal, startT);
    g.gain.exponentialRampToValueAtTime(0.0001, startT + duration);

    src.connect(filter);
    filter.connect(g);
    g.connect(_masterGain);
    src.start(startT);
    src.stop(startT + duration + 0.02);
}

// ─── Sound definitions ───────────────────────────────────────────────────────

/** Soft distant earth thud – blends into ambient background activity */
function _playDig(ctx) {
    const t = ctx.currentTime;
    // Very muffled, low-frequency, short — reads as distant background work, not a foreground pop
    _noise(ctx, t, 0.06, 0.10, 160);              // 160 Hz (lower than before), very quiet, 60ms
    _osc(ctx, 'sine', 75, t, t + 0.06, 0.08, 55); // sub-bass body, gain 0.08 (was 0.3)
}

/** Two-tone click – block placed */
function _playBuild(ctx) {
    const t = ctx.currentTime;
    _osc(ctx, 'square', 520, t, t + 0.06, 0.25, 560);
    _osc(ctx, 'sine',   260, t + 0.03, t + 0.10, 0.20);
}

/** Soft rising chime – eating/collecting food */
function _playEat(ctx) {
    const t = ctx.currentTime;
    _osc(ctx, 'sine', 660, t,        t + 0.15, 0.30, 880);
    _osc(ctx, 'sine', 880, t + 0.08, t + 0.22, 0.20, 1100);
}

/** Short chirp – two characters greeting */
function _playSocial(ctx) {
    const t = ctx.currentTime;
    _osc(ctx, 'sine', 740, t,        t + 0.08, 0.22, 880);
    _osc(ctx, 'sine', 880, t + 0.06, t + 0.14, 0.15, 660);
}

/** Descending tone + noise – character dies */
function _playDeath(ctx) {
    const t = ctx.currentTime;
    _osc(ctx, 'sawtooth', 320, t, t + 0.45, 0.28, 80);
    _noise(ctx, t + 0.10, 0.30, 0.22, 180);
}

/** Slow descending bell chord – dusk / lights on */
function _playNight(ctx) {
    const t = ctx.currentTime;
    _osc(ctx, 'sine',     440, t,        t + 1.2, 0.18, 330);
    _osc(ctx, 'sine',     330, t + 0.15, t + 1.4, 0.12, 220);
    _osc(ctx, 'triangle', 220, t + 0.30, t + 1.6, 0.08, 165);
}

/** Gentle ascending arpeggio – dawn / new day */
function _playDawn(ctx) {
    const t = ctx.currentTime;
    _osc(ctx, 'sine', 330, t,        t + 0.5, 0.16, 440);
    _osc(ctx, 'sine', 440, t + 0.18, t + 0.7, 0.14, 550);
    _osc(ctx, 'sine', 550, t + 0.36, t + 0.9, 0.12, 660);
}

/** Soft wooden thud + brief air whoosh – character enters home */
function _playEnterHome(ctx) {
    const t = ctx.currentTime;
    // Low woody knock
    _noise(ctx, t, 0.08, 0.35, 320);
    _osc(ctx, 'sine', 200, t, t + 0.10, 0.22, 140);
    // Quiet door-close creak
    _osc(ctx, 'triangle', 480, t + 0.05, t + 0.18, 0.10, 280);
}

/** Soft creak + airy pop – character emerges from home */
function _playLeaveHome(ctx) {
    const t = ctx.currentTime;
    // Door-open creak
    _osc(ctx, 'triangle', 260, t,        t + 0.15, 0.12, 440);
    // Bright little emergence chime
    _osc(ctx, 'sine',     660, t + 0.10, t + 0.28, 0.16, 880);
    _noise(ctx, t + 0.08, 0.12, 0.18, 900);
}

/**
 * Thunder: sharp crack + low rolling rumble.
 * Called from rain-system.js when a lightning strike triggers.
 * Distance-randomised: closer strikes are louder/sharper.
 */
function _playThunder(ctx, distance = 0.5) {
    const t = ctx.currentTime;
    const crackGain  = 0.65 * (1 - distance * 0.6); // louder when close
    const rumbleGain = 0.45 * (1 - distance * 0.4);
    // Sharp broadband crack (short burst of white noise through a highpass)
    const sr = ctx.sampleRate;
    const crackLen = Math.floor(sr * 0.12);
    const crackBuf = ctx.createBuffer(1, crackLen, sr);
    const crackData = crackBuf.getChannelData(0);
    for (let i = 0; i < crackLen; i++) crackData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sr * 0.03));
    const crackSrc = ctx.createBufferSource();
    crackSrc.buffer = crackBuf;
    const crackHp = ctx.createBiquadFilter();
    crackHp.type = 'highpass';
    crackHp.frequency.value = 800;
    const crackG = ctx.createGain();
    crackG.gain.value = crackGain;
    crackSrc.connect(crackHp);
    crackHp.connect(crackG);
    crackG.connect(_masterGain);
    crackSrc.start(t);
    // Descending bass rumble
    _osc(ctx, 'sawtooth', 80,  t + 0.05, t + 1.8, rumbleGain * 0.6, 28);
    _osc(ctx, 'sine',     55,  t + 0.10, t + 2.4, rumbleGain * 0.4, 18);
    _noise(ctx, t + 0.05, 2.2, rumbleGain * 0.55, 160);
}
// Persistent looping wind + periodic bird/cricket schedulers.
// Rain layer: looping filtered noise, gain cross-faded by rain-system.js state.
// All ambient nodes route through their own gain nodes.

let _ambWindSrc   = null;   // BufferSource (looping)
let _ambWindGain  = null;   // GainNode for wind layer
let _ambRainSrc   = null;   // BufferSource (looping) for rain
let _ambRainGain  = null;   // GainNode for rain layer
let _ambBirdGain  = null;   // GainNode for bird layer
let _ambCricketGain = null; // GainNode for cricket layer
let _ambActive    = false;  // whether ambient loop is running
let _ambBirdTimer = null;
let _ambCricketTimer = null;
let _ambLastUpdate = -Infinity; // time of last updateAmbience call (ms)

/** Create a looping wind noise source routed to destGain */
function _startWind(ctx, destGain) {
    const sr = ctx.sampleRate;
    const bufLen = sr * 4; // 4-second buffer, looped
    const buf = ctx.createBuffer(1, bufLen, sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 350;
    lp.Q.value = 0.7;

    src.connect(lp);
    lp.connect(destGain);
    src.start();
    return src;
}

/** Schedule one bird chirp, then reschedule after a random delay */
function _scheduleBird(ctx) {
    if (!_ambActive || !_ambBirdGain) return;
    const t = ctx.currentTime;
    const freq = 1200 + Math.random() * 900;
    // Short two-note chirp
    _oscTo(_ambBirdGain, ctx, 'sine', freq,        t,        t + 0.07, 0.18, freq * 1.5);
    if (Math.random() > 0.45) {
        _oscTo(_ambBirdGain, ctx, 'sine', freq * 1.3, t + 0.05, t + 0.14, 0.12, freq * 1.9);
    }
    const delay = 1200 + Math.random() * 3200;
    _ambBirdTimer = setTimeout(() => _scheduleBird(ctx), delay);
}

/** Schedule one cricket pulse (rapid stridulation), then reschedule */
function _scheduleCricket(ctx) {
    if (!_ambActive || !_ambCricketGain) return;
    const t = ctx.currentTime;
    const freq = 3100 + Math.random() * 500;
    for (let i = 0; i < 4; i++) {
        _oscTo(_ambCricketGain, ctx, 'sine', freq, t + i * 0.048, t + i * 0.048 + 0.038, 0.10);
    }
    const delay = 700 + Math.random() * 1100;
    _ambCricketTimer = setTimeout(() => _scheduleCricket(ctx), delay);
}

/** Like _osc but routes to an explicit destNode instead of _masterGain */
function _oscTo(dest, ctx, type, freq, startT, endT, gainVal, freqEnd = null) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(gainVal, startT);
    g.gain.exponentialRampToValueAtTime(0.0001, endT);
    g.connect(dest);

    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, startT);
    if (freqEnd !== null) o.frequency.exponentialRampToValueAtTime(freqEnd, endT);
    o.connect(g);
    o.start(startT);
    o.stop(endT + 0.01);
}

/** Start a looping rain noise source routed to destGain */
function _startRain(ctx, destGain) {
    const sr = ctx.sampleRate;
    const bufLen = Math.floor(sr * 3);
    const buf = ctx.createBuffer(2, bufLen, sr);
    for (let ch = 0; ch < 2; ch++) {
        const data = buf.getChannelData(ch);
        for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1200;
    hp.Q.value = 0.5;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400;
    bp.Q.value = 0.8;

    src.connect(hp);
    hp.connect(bp);
    bp.connect(destGain);
    src.start();
    return src;
}

/** Initialise ambient nodes (called once, after AudioContext is ready) */
function _initAmbience(ctx) {
    _ambWindGain = ctx.createGain();
    _ambWindGain.gain.value = 0.08;
    _ambWindGain.connect(_masterGain);
    _ambWindSrc = _startWind(ctx, _ambWindGain);

    _ambRainGain = ctx.createGain();
    _ambRainGain.gain.value = 0;
    _ambRainGain.connect(_masterGain);
    _ambRainSrc = _startRain(ctx, _ambRainGain);

    _ambBirdGain = ctx.createGain();
    _ambBirdGain.gain.value = 0;
    _ambBirdGain.connect(_masterGain);

    _ambCricketGain = ctx.createGain();
    _ambCricketGain.gain.value = 0;
    _ambCricketGain.connect(_masterGain);

    _ambActive = true;
    _scheduleBird(ctx);
    _scheduleCricket(ctx);
}

/** Stop all ambient sound and release nodes */
export function stopAmbience() {
    _ambActive = false;
    clearTimeout(_ambBirdTimer);
    clearTimeout(_ambCricketTimer);
    _ambBirdTimer = null;
    _ambCricketTimer = null;
    if (_ambWindSrc) { try { _ambWindSrc.stop(); } catch (_) {} _ambWindSrc = null; }
    if (_ambRainSrc) { try { _ambRainSrc.stop(); } catch (_) {} _ambRainSrc = null; }
    _ambWindGain = _ambRainGain = _ambBirdGain = _ambCricketGain = null;
}

/**
 * Update ambient mix to match current world state.
 * Should be called ~once per second from world.js animate().
 *
 * @param {boolean} isNight       true = night half of day cycle
 * @param {number}  seasonPhase   0-1 over full season cycle (0=Spring…0.75=Winter)
 */
export function updateAmbience(isNight, seasonPhase) {
    if (typeof window === 'undefined' || window.soundEnabled !== true) {
        if (_ambActive) stopAmbience();
        return;
    }

    // Throttle: once per second in wall-clock time
    const now = performance.now();
    if (now - _ambLastUpdate < 1000) return;
    _ambLastUpdate = now;

    const ctx = _getCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    if (!_ambActive || !_ambWindGain) _initAmbience(ctx);

    const t = ctx.currentTime;
    const quarter = Math.floor(Math.min(seasonPhase, 0.9999) * 4); // 0=Spring,1=Summer,2=Autumn,3=Winter
    const isWinter = quarter === 3;
    const isAutumn = quarter === 2;
    const isSummer = quarter === 1;

    // Wind: louder in autumn/winter, or during heavy rain; barely changes for drizzle
    const isRaining   = (typeof window !== 'undefined' && !!window._isRaining);
    const rainType    = (typeof window !== 'undefined' && window._rainType) || null;
    const isHeavy     = isRaining && rainType === 'heavy';
    const isDrizzle   = isRaining && rainType === 'drizzle';
    const windTarget  = isHeavy ? 0.18 : isDrizzle ? 0.07 : isWinter ? 0.20 : isAutumn ? 0.13 : 0.06;
    _ambWindGain.gain.setTargetAtTime(windTarget, t, 4.0);

    // Rain: heavy is loud (0.55), drizzle is soft (0.22); 5 s cross-fade
    const rainTarget = isHeavy ? 0.55 : isDrizzle ? 0.22 : 0;
    if (_ambRainGain) _ambRainGain.gain.setTargetAtTime(rainTarget, t, 5.0);

    // Birds: silenced by heavy rain, only slightly reduced in drizzle (rain on leaves sounds nice)
    let birdTarget = 0;
    if (!isNight && !isWinter && !isHeavy) birdTarget = isDrizzle ? 0.30 : isAutumn ? 0.35 : isSummer ? 0.85 : 0.70;
    _ambBirdGain.gain.setTargetAtTime(birdTarget, t, 3.0);

    // Crickets: night only, spring/summer present, autumn faint, winter off
    let cricketTarget = 0;
    if (isNight && !isWinter) cricketTarget = isSummer ? 0.80 : isAutumn ? 0.30 : 0.60;
    _ambCricketGain.gain.setTargetAtTime(cricketTarget, t, 3.0);

    // Ensure schedulers are alive (they self-cancel if _ambActive was false)
    if (!_ambBirdTimer)   _scheduleBird(ctx);
    if (!_ambCricketTimer) _scheduleCricket(ctx);
}
