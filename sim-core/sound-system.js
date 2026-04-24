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
        _masterGain.gain.value = 0.18; // low master volume
        _masterGain.connect(_ctx.destination);
    } catch (_) {
        _ctx = null;
    }
    return _ctx;
}

// Per-sound cooldown map (ms timestamps of last play)
const _lastPlay = {};
const THROTTLE = {
    dig:    120,
    build:  200,
    eat:    300,
    social: 400,
    death:  600,
    night:  0,
    dawn:   0,
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
        case 'night':  _playNight(ctx);  break;
        case 'dawn':   _playDawn(ctx);   break;
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

/** Short percussive thud – earth/stone impact */
function _playDig(ctx) {
    const t = ctx.currentTime;
    _noise(ctx, t, 0.10, 0.5, 250);          // low thud
    _osc(ctx, 'sine', 90, t, t + 0.08, 0.3, 60); // body drop
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
