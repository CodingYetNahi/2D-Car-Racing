const ENGINE_SAMPLE_URL = "https://opengameart.org/sites/default/files/loop_2_0.wav";

export class EngineAudio {
  constructor() {
    this.audio = null;
    this.enabled = false;
    this.running = false;
    this.mixLevel = 1;
  }

  async enableFromUserGesture() {
    this.enabled = true;
    if (!this.audio) this.#createPlayer();
    this.#applyState();
    if (this.running) {
      try { await this.audio.play(); } catch { /* Browser may require another user gesture. */ }
    }
  }

  disable() {
    this.enabled = false;
    this.#applyState();
  }

  setRunning(running) {
    this.running = Boolean(running);
    if (!this.audio) return;
    this.#applyState();
    if (this.enabled && this.running) {
      void this.audio.play().catch(() => {});
    } else {
      this.audio.pause();
    }
  }

  setSpeed(speed) {
    if (!this.audio) return;
    const normalized = Math.max(0, Math.min(1, (Number(speed) - 245) / 225));
    this.audio.playbackRate = 0.88 + normalized * 0.32;
  }

  setMixLevel(level) {
    const numericLevel = Number(level);
    this.mixLevel = Number.isFinite(numericLevel) ? Math.max(0.2, Math.min(1, numericLevel)) : 1;
    this.#applyState();
  }

  suspend() {
    this.audio?.pause();
    return Promise.resolve();
  }

  #createPlayer() {
    this.audio = new Audio(ENGINE_SAMPLE_URL);
    this.audio.loop = true;
    this.audio.preload = "auto";
    this.audio.crossOrigin = "anonymous";
    this.audio.volume = 0;
  }

  #applyState() {
    if (!this.audio) return;
    this.audio.volume = this.enabled && this.running ? 0.7 * this.mixLevel : 0;
    if ((!this.enabled || !this.running) && !this.audio.paused) this.audio.pause();
  }
}
