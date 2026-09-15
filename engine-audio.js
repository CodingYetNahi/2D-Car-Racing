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

    // Unlock the HTMLMediaElement while we are still inside the user's click/tap.
    // This matters on iOS/Safari: waiting until the race starts can make play()
    // count as a later, non-gesture request and the browser may reject it.
    const shouldKeepPlaying = this.running;
    this.audio.volume = 0;
    try {
      await this.audio.play();
      if (!shouldKeepPlaying) {
        this.audio.pause();
        this.audio.currentTime = 0;
      }
    } catch {
      // Keep the control usable. A later direct tap can retry playback.
    }
    this.#applyState();
    if (shouldKeepPlaying && this.audio.paused) void this.audio.play().catch(() => {});
  }

  disable() {
    this.enabled = false;
    this.#applyState();
  }

  setRunning(running) {
    this.running = Boolean(running);
    if (!this.audio) return;
    this.#applyState();
    if (this.enabled && this.running) void this.audio.play().catch(() => {});
    else this.audio.pause();
  }

  setSpeed(speed) {
    if (!this.audio) return;
    const normalized = Math.max(0, Math.min(1, (Number(speed) - 245) / 225));
    this.audio.playbackRate = 0.9 + normalized * 0.28;
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
    this.audio = new Audio();
    this.audio.src = ENGINE_SAMPLE_URL;
    this.audio.loop = true;
    this.audio.preload = "auto";
    // Do not set crossOrigin here. We are playing the remote sample directly
    // rather than reading it through Web Audio/canvas, so requiring CORS can
    // unnecessarily block otherwise valid media playback.
    this.audio.playsInline = true;
    this.audio.volume = 0;
    this.audio.load();
  }

  #applyState() {
    if (!this.audio) return;
    this.audio.volume = this.enabled && this.running ? 0.9 * this.mixLevel : 0;
    if ((!this.enabled || !this.running) && !this.audio.paused) this.audio.pause();
  }
}
