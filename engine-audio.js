export class EngineAudio {
  constructor(AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext) {
    this.AudioContextClass = AudioContextClass;
    this.context = null;
    this.master = null;
    this.oscillators = [];
    this.enabled = false;
    this.running = false;
    this.mixLevel = 1;
  }

  async enableFromUserGesture() {
    this.enabled = true;
    if (!this.context) this.#createGraph();
    await this.context.resume();
    this.#applyGain();
  }

  disable() {
    this.enabled = false;
    this.#applyGain();
  }

  setRunning(running) {
    this.running = Boolean(running);
    this.#applyGain();
  }

  setSpeed(speed) {
    if (!this.context || this.oscillators.length === 0) return;
    const normalized = Math.max(0, Math.min(1, (speed - 245) / 225));
    const now = this.context.currentTime;
    this.oscillators[0].frequency.setTargetAtTime(54 + normalized * 18, now, 0.12);
    this.oscillators[1].frequency.setTargetAtTime(108 + normalized * 36, now, 0.12);
  }

  setMixLevel(level) {
    const numericLevel = Number(level);
    this.mixLevel = Number.isFinite(numericLevel) ? Math.max(0.2, Math.min(1, numericLevel)) : 1;
    this.#applyGain();
  }

  suspend() {
    return this.context?.suspend() || Promise.resolve();
  }

  #createGraph() {
    if (!this.AudioContextClass) throw new Error("Web Audio is not supported.");
    this.context = new this.AudioContextClass();
    this.master = this.context.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.context.destination);
    const filter = this.context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 320;
    filter.Q.value = 0.7;
    filter.connect(this.master);
    for (const [frequency, gainValue] of [[54, 0.055], [108, 0.018]]) {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.value = gainValue;
      oscillator.connect(gain).connect(filter);
      oscillator.start();
      this.oscillators.push(oscillator);
    }
  }

  #applyGain() {
    if (!this.master || !this.context) return;
    this.master.gain.setTargetAtTime(this.enabled && this.running ? 0.65 * this.mixLevel : 0, this.context.currentTime, 0.08);
  }
}
