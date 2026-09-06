const SPOTIFY_API_SRC = "https://open.spotify.com/embed/iframe-api/v1";
let apiPromise = null;

export function normalizeSpotifyPlaylistUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.hostname !== "open.spotify.com") return "";
    const match = url.pathname.match(/^\/(?:embed\/)?playlist\/([A-Za-z0-9]+)\/?$/);
    return match ? `https://open.spotify.com/playlist/${match[1]}` : "";
  } catch {
    return "";
  }
}

export function loadSpotifyIframeApi(documentObject = globalThis.document, windowObject = globalThis.window) {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const script = documentObject.createElement("script");
    const fail = (message) => {
      script.remove();
      apiPromise = null;
      reject(new Error(message));
    };
    const timeoutId = windowObject.setTimeout(() => fail("Spotify took too long to load."), 10000);
    windowObject.onSpotifyIframeApiReady = (IFrameAPI) => {
      windowObject.clearTimeout(timeoutId);
      resolve(IFrameAPI);
    };
    script.src = SPOTIFY_API_SRC;
    script.async = true;
    script.dataset.spotifyIframeApi = "true";
    script.onerror = () => {
      windowObject.clearTimeout(timeoutId);
      fail("Spotify could not be loaded.");
    };
    documentObject.head.appendChild(script);
  });
  return apiPromise;
}

export class SpotifyPlaylistPlayer {
  constructor({ container, statusElement = null, onPlaybackChange = () => {}, loadApi = loadSpotifyIframeApi }) {
    this.container = container;
    this.statusElement = statusElement;
    this.onPlaybackChange = onPlaybackChange;
    this.loadApi = loadApi;
    this.controller = null;
    this.initializing = null;
  }

  setStatus(message) {
    if (this.statusElement) this.statusElement.textContent = message;
  }

  async initialize(rawPlaylistUrl) {
    const playlistUrl = normalizeSpotifyPlaylistUrl(rawPlaylistUrl);
    if (!playlistUrl) {
      this.setStatus("Spotify playlist is not configured yet.");
      return false;
    }
    if (this.controller) return true;
    if (this.initializing) return this.initializing;

    this.setStatus("Loading Spotify…");
    this.initializing = this.loadApi()
      .then((IFrameAPI) => new Promise((resolve) => {
        IFrameAPI.createController(this.container, { url: playlistUrl, width: "100%", height: 152 }, (controller) => {
          this.controller = controller;
          controller.addListener("ready", () => this.setStatus("Press Play in Spotify to start music."));
          controller.addListener("playback_started", () => this.onPlaybackChange(true));
          controller.addListener("playback_update", (event) => this.onPlaybackChange(!event?.data?.isPaused));
          resolve(true);
        });
      }))
      .catch((error) => {
        this.setStatus(error?.message || "Spotify could not be loaded.");
        return false;
      })
      .finally(() => { this.initializing = null; });
    return this.initializing;
  }

  pause() {
    this.controller?.pause();
    this.onPlaybackChange(false);
  }

  destroy() {
    this.controller?.destroy();
    this.controller = null;
    this.onPlaybackChange(false);
  }
}
