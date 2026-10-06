// Synthesised bounce: a low thump from the floor, the hollow ring of the ball,
// and a short slap of rubber on wood, with a little hall reverb.

function hallImpulse(ctx) {
  const seconds = 1.3;
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let low = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      // The tail darkens as it decays, like a large room.
      const k = 0.55 - 0.45 * t;
      low += k * (Math.random() * 2 - 1 - low);
      data[i] = low * Math.exp(-6.5 * t);
    }
  }
  return buffer;
}

function noiseBurst(ctx) {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.12), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

export function createAudio() {
  let ctx = null, bus = null, noise = null;
  let muted = false;

  function build() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    ctx = new AudioContext();
    noise = noiseBurst(ctx);
    bus = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.ratio.value = 6;
    const master = ctx.createGain();
    master.gain.value = 0.7;
    const hall = ctx.createConvolver();
    hall.buffer = hallImpulse(ctx);
    const wet = ctx.createGain();
    wet.gain.value = 0.16;
    bus.connect(limiter);
    bus.connect(hall).connect(wet).connect(limiter);
    limiter.connect(master).connect(ctx.destination);
  }

  function tone(type, from, to, sweep, level, decay, at) {
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, at);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, at + sweep);
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.linearRampToValueAtTime(level, at + 0.004);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    osc.connect(amp).connect(bus);
    osc.start(at);
    osc.stop(at + decay + 0.02);
  }

  return {
    // Browsers only allow sound after a user gesture.
    unlock() {
      if (!ctx) build();
      if (ctx && ctx.state === 'suspended') ctx.resume();
    },
    setMuted(value) {
      muted = value;
    },
    impact(speed) {
      if (!ctx || muted || ctx.state !== 'running' || speed < 0.2) return;
      const level = Math.min(speed / 4.5, 1.25) ** 1.4;
      const at = ctx.currentTime + 0.003;
      tone('sine', 175 + 45 * level, 60, 0.09, 0.9 * level, 0.2, at);
      tone('triangle', 245, 245, 0, 0.2 * level, 0.11, at);
      tone('sine', 930, 930, 0, 0.06 * level, 0.15, at);

      const slap = ctx.createBufferSource();
      slap.buffer = noise;
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 1700;
      band.Q.value = 0.7;
      const amp = ctx.createGain();
      amp.gain.setValueAtTime(0.4 * level, at);
      amp.gain.exponentialRampToValueAtTime(0.0001, at + 0.035);
      slap.connect(band).connect(amp).connect(bus);
      slap.start(at);
      slap.stop(at + 0.06);
    },
  };
}
