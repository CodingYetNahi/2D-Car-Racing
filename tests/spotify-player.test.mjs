import assert from "node:assert/strict";
import test from "node:test";
import { SpotifyPlaylistPlayer, normalizeSpotifyPlaylistUrl } from "../spotify-player.js";

test("Spotify accepts only canonical public playlist URLs", () => {
  assert.equal(
    normalizeSpotifyPlaylistUrl("https://open.spotify.com/playlist/37i9dQZF1DX4WYpdgoIcn6?si=test"),
    "https://open.spotify.com/playlist/37i9dQZF1DX4WYpdgoIcn6"
  );
  assert.equal(normalizeSpotifyPlaylistUrl("https://evil.example/playlist/abc"), "");
  assert.equal(normalizeSpotifyPlaylistUrl("javascript:alert(1)"), "");
  assert.equal(normalizeSpotifyPlaylistUrl("https://open.spotify.com/track/abc"), "");
});

test("Spotify creates one controller and pauses cleanly", async () => {
  let createCount = 0;
  let pauseCount = 0;
  const listeners = new Map();
  const controller = {
    addListener(name, callback) { listeners.set(name, callback); },
    pause() { pauseCount += 1; },
    destroy() {}
  };
  const loadApi = async () => ({
    createController(_container, _options, callback) {
      createCount += 1;
      callback(controller);
    }
  });
  const playback = [];
  const player = new SpotifyPlaylistPlayer({
    container: {},
    loadApi,
    onPlaybackChange: (playing) => playback.push(playing)
  });
  const url = "https://open.spotify.com/playlist/37i9dQZF1DX4WYpdgoIcn6";
  await Promise.all([player.initialize(url), player.initialize(url)]);
  await player.initialize(url);
  assert.equal(createCount, 1);
  listeners.get("playback_started")({ data: {} });
  listeners.get("playback_update")({ data: { isPaused: true } });
  player.pause();
  assert.deepEqual(playback, [true, false, false]);
  assert.equal(pauseCount, 1);
});
