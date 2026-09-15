const ENGINE_SAMPLE_URL = "https://raw.githubusercontent.com/clhforensics/indygp/a18d5b44c62b5376987116a5bc475ba91cd68801/packages/render/public/assets/audio/engine/f1_rpm_step_2.wav";

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
    this.audio.muted = false;
    this.audio.volume = 0.9 * this.mixLevel;
    try {
      // Start the real media sample inside the click/tap itself. Do not pause it
      // here: the caller immediately synchronizes running state afterwards.
      // This preserves Safari/iOS media activation for a race already in progress.
      await this.audio.play();
      return true;
    } catch (error) {
      this.enabled = false;
      this.audio.pause();
      console.warn("Engine audio could not start:", error);
      throw error;
    }
  }

  disable() { this.enabled = false; this.#applyState(); }

  setRunning(running) {
    this.running = Boolean(running);
    if (!this.audio) return;
    this.#applyState();
    if (this.enabled && this.running && this.audio.paused) {
      void this.audio.play().catch((error) => console.warn("Engine audio playback failed:", error));
    }
  }

  setSpeed(speed) {
    if (!this.audio) return;
    const normalized = Math.max(0, Math.min(1, (Number(speed) - 245) / 225));
    this.audio.playbackRate = 0.92 + normalized * 0.24;
  }

  setMixLevel(level) {
    const numericLevel = Number(level);
    this.mixLevel = Number.isFinite(numericLevel) ? Math.max(0.2, Math.min(1, numericLevel)) : 1;
    this.#applyState();
  }

  suspend() { this.audio?.pause(); return Promise.resolve(); }

  #createPlayer() {
    this.audio = new Audio(ENGINE_SAMPLE_URL);
    this.audio.loop = true;
    this.audio.preload = "auto";
    this.audio.playsInline = true;
    this.audio.muted = false;
    this.audio.volume = 0.9 * this.mixLevel;
  }

  #applyState() {
    if (!this.audio) return;
    this.audio.muted = false;
    this.audio.volume = this.enabled && this.running ? 0.9 * this.mixLevel : 0;
    if ((!this.enabled || !this.running) && !this.audio.paused) this.audio.pause();
  }
}
