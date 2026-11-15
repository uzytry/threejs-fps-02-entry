// Sound, synthesized: every effect is an oscillator or filtered noise burst built
// in WebAudio, so the game ships no audio files and makes no network request. The
// context is created on the first user gesture (the play click) and stays muted in
// screenshot mode, where nothing is ever unlocked.
export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;
  let noiseBuffer = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      const length = ctx.sampleRate;
      noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
      return true;
    } catch {
      ctx = null;
      return false;
    }
  }

  function noise(when, duration, filterFreq, gainValue, type = 'lowpass') {
    if (!ctx || muted) return;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + duration);
    source.connect(filter).connect(gain).connect(master);
    source.start(when);
    source.stop(when + duration + 0.05);
  }

  function tone(when, freqFrom, freqTo, duration, gainValue, type = 'sine') {
    if (!ctx || muted) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freqFrom, when);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqTo), when + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + duration);
    osc.connect(gain).connect(master);
    osc.start(when);
    osc.stop(when + duration + 0.05);
  }

  return {
    unlock() {
      ensure();
    },
    toggleMute() {
      muted = !muted;
      return muted;
    },
    shot(kind) {
      if (!ensure()) return;
      const t = ctx.currentTime;
      if (kind === 'rifle') {
        noise(t, 0.12, 1800, 0.5);
        tone(t, 160, 50, 0.1, 0.4, 'square');
      } else if (kind === 'smg') {
        noise(t, 0.09, 2400, 0.38);
        tone(t, 200, 70, 0.07, 0.3, 'square');
      } else {
        noise(t, 0.14, 1400, 0.55);
        tone(t, 130, 45, 0.12, 0.45, 'square');
      }
    },
    // A distant shot: the same shape, quieter and duller.
    distantShot() {
      if (!ensure()) return;
      noise(ctx.currentTime, 0.14, 700, 0.14);
    },
    dryFire() {
      if (!ensure()) return;
      tone(ctx.currentTime, 1400, 900, 0.05, 0.2, 'square');
    },
    reload() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      tone(t, 700, 500, 0.05, 0.2, 'square');
      tone(t + 0.25, 500, 800, 0.06, 0.25, 'square');
    },
    hit(killed) {
      if (!ensure()) return;
      const t = ctx.currentTime;
      tone(t, 2400, 2400, 0.05, 0.3, 'sine');
      if (killed) tone(t + 0.07, 1800, 1800, 0.09, 0.3, 'sine');
    },
    hurt() {
      if (!ensure()) return;
      tone(ctx.currentTime, 220, 90, 0.15, 0.35, 'sawtooth');
    },
    explosion() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      noise(t, 0.9, 320, 0.9);
      tone(t, 90, 28, 0.8, 0.7, 'sine');
    },
    beep(high) {
      if (!ensure()) return;
      tone(ctx.currentTime, high ? 1560 : 1180, high ? 1560 : 1180, 0.09, 0.3, 'square');
    },
    plant() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      tone(t, 880, 880, 0.12, 0.3, 'square');
      tone(t + 0.16, 1320, 1320, 0.18, 0.3, 'square');
    },
    roundWin() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      tone(t, 523, 523, 0.16, 0.3, 'triangle');
      tone(t + 0.16, 659, 659, 0.16, 0.3, 'triangle');
      tone(t + 0.32, 784, 784, 0.3, 0.3, 'triangle');
    },
    roundLose() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      tone(t, 392, 392, 0.2, 0.3, 'triangle');
      tone(t + 0.2, 311, 311, 0.35, 0.3, 'triangle');
    },
    buy() {
      if (!ensure()) return;
      tone(ctx.currentTime, 990, 990, 0.07, 0.25, 'triangle');
    },
  };
}
