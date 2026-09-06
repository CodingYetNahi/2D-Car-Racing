import assert from "node:assert/strict";
import test from "node:test";
import { EngineAudio } from "../engine-audio.js";
import { DEFAULT_SKIN, resolveSelectedSkin } from "../skin-policy.js";
import { weatherState } from "../weather.js";

test("weather transitions are continuous and frame-rate independent", () => {
  const before = weatherState(18 * 60);
  const midway = weatherState(20 * 60);
  const almostAfter = weatherState(22 * 60 - 1);
  const after = weatherState(22 * 60);
  assert.equal(before.mix, 0);
  assert.ok(midway.mix > 0 && midway.mix < 1);
  assert.ok(almostAfter.mix > 0.999);
  assert.equal(after.mix, 0);
  assert.equal(almostAfter.next, after.current);
  assert.deepEqual(weatherState(1200, 60), weatherState(2400, 120));
});

test("saved skins require a freshly server-verified pass", () => {
  assert.equal(resolveSelectedSkin("royal", true), "royal");
  assert.equal(resolveSelectedSkin("royal", false), DEFAULT_SKIN);
  assert.equal(resolveSelectedSkin("../../forged", true), DEFAULT_SKIN);
  assert.equal(resolveSelectedSkin(null, true), DEFAULT_SKIN);
});

function fakeAudioContext() {
  const parameter = () => ({ value: 0, setTargetAtTime() {} });
  return class {
    static instances = [];
    constructor() { this.constructor.instances.push(this); this.currentTime = 0; this.destination = {}; }
    createGain() { return { gain: parameter(), connect() { return this; } }; }
    createBiquadFilter() { return { frequency: parameter(), Q: parameter(), connect() { return this; } }; }
    createOscillator() { return { frequency: parameter(), connect() { return this; }, start() {} }; }
    resume() { return Promise.resolve(); }
    suspend() { return Promise.resolve(); }
  };
}

test("engine audio creates one reusable graph across pause, crash and restart", async () => {
  const FakeAudioContext = fakeAudioContext();
  const audio = new EngineAudio(FakeAudioContext);
  assert.equal(FakeAudioContext.instances.length, 0, "autoplay must not create audio");
  await audio.enableFromUserGesture();
  audio.setRunning(true);
  audio.setSpeed(470);
  audio.setRunning(false);
  audio.setRunning(true);
  await audio.enableFromUserGesture();
  audio.disable();
  assert.equal(FakeAudioContext.instances.length, 1);
  assert.equal(audio.oscillators.length, 2);
});
