import assert from "node:assert/strict";
import test from "node:test";
import { SpotifyPlaylistPlayer, normalizeSpotifyPlaylistUrl, spotifyEmbedUrl } from "../spotify-player.js";

test("Spotify accepts only canonical public playlist URLs", () => {
  assert.equal(
    normalizeSpotifyPlaylistUrl("https://open.spotify.com/playlist/37i9dQZF1DX4WYpdgoIcn6?si=test"),
    "https://open.spotify.com/playlist/37i9dQZF1DX4WYpdgoIcn6"
  );
  assert.equal(normalizeSpotifyPlaylistUrl("https://evil.example/playlist/abc"), "");
  assert.equal(normalizeSpotifyPlaylistUrl("javascript:alert(1)"), "");
  assert.equal(normalizeSpotifyPlaylistUrl("https://open.spotify.com/track/abc"), "");
  assert.equal(
    spotifyEmbedUrl("https://open.spotify.com/playlist/37i9dQZF1DX4WYpdgoIcn6?si=test"),
    "https://open.spotify.com/embed/playlist/37i9dQZF1DX4WYpdgoIcn6"
  );
});

test("Spotify creates one direct iframe only after user initialization", async () => {
  let createdCount = 0;
  let loadListener = null;
  let removedCount = 0;
  const iframe = {
    setAttribute() {},
    addEventListener(name, callback) { if (name === "load") loadListener = callback; },
    remove() { removedCount += 1; }
  };
  const documentObject = { createElement(tag) { assert.equal(tag, "iframe"); createdCount += 1; return iframe; } };
  const children = [];
  const container = { replaceChildren(child) { children.splice(0, children.length, child); } };
  const statusElement = { textContent: "" };
  const playback = [];
  const player = new SpotifyPlaylistPlayer({
    container,
    statusElement,
    documentObject,
    onPlaybackChange: (playing) => playback.push(playing)
  });
  const url = "https://open.spotify.com/playlist/37i9dQZF1DX4WYpdgoIcn6";
  await Promise.all([player.initialize(url), player.initialize(url)]);
  await player.initialize(url);
  assert.equal(createdCount, 1);
  assert.equal(children.length, 1);
  assert.equal(iframe.src, "https://open.spotify.com/embed/playlist/37i9dQZF1DX4WYpdgoIcn6");
  assert.equal(iframe.loading, "eager");
  assert.equal(iframe.height, "152");
  loadListener();
  assert.equal(statusElement.textContent, "Press Play in Spotify to start music.");
  player.destroy();
  assert.equal(removedCount, 1);
  assert.deepEqual(playback, [false]);
});
