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

export function spotifyEmbedUrl(value) {
  const playlistUrl = normalizeSpotifyPlaylistUrl(value);
  if (!playlistUrl) return "";
  const playlistId = new URL(playlistUrl).pathname.split("/").at(-1);
  return `https://open.spotify.com/embed/playlist/${playlistId}`;
}

export class SpotifyPlaylistPlayer {
  constructor({ container, statusElement = null, documentObject = globalThis.document, onPlaybackChange = () => {} }) {
    this.container = container;
    this.statusElement = statusElement;
    this.documentObject = documentObject;
    this.onPlaybackChange = onPlaybackChange;
    this.iframe = null;
  }

  setStatus(message) {
    if (this.statusElement) this.statusElement.textContent = message;
  }

  async initialize(rawPlaylistUrl) {
    const embedUrl = spotifyEmbedUrl(rawPlaylistUrl);
    if (!embedUrl) {
      this.setStatus("Spotify playlist is not configured yet.");
      return false;
    }
    if (this.iframe) return true;

    const iframe = this.documentObject.createElement("iframe");
    iframe.src = embedUrl;
    iframe.title = "Spotify playlist";
    iframe.width = "100%";
    iframe.height = "152";
    iframe.loading = "eager";
    iframe.allow = "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture";
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    iframe.setAttribute("allowfullscreen", "");
    iframe.addEventListener("load", () => this.setStatus("Press Play in Spotify to start music."), { once: true });
    iframe.addEventListener("error", () => this.setStatus("Spotify could not be loaded. The game is still available."), { once: true });
    this.setStatus("Loading Spotify…");
    this.container.replaceChildren(iframe);
    this.iframe = iframe;
    return true;
  }

  pause() {
    // Direct embeds do not expose reliable playback-state or pause events.
    // Closing the panel calls destroy(), which stops playback with the iframe.
    this.onPlaybackChange(false);
  }

  destroy() {
    this.iframe?.remove();
    this.iframe = null;
    this.onPlaybackChange(false);
  }
}
