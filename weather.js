export const WEATHER_THEMES = Object.freeze([
  Object.freeze({ verge: "#176b37", road: "#272b2e", precipitation: "none" }),
  Object.freeze({ verge: "#526a72", road: "#30383c", precipitation: "rain" }),
  Object.freeze({ verge: "#d9e7ec", road: "#566066", precipitation: "snow" }),
  Object.freeze({ verge: "#49351d", road: "#34302b", precipitation: "none" }),
  Object.freeze({ verge: "#071329", road: "#121923", precipitation: "none" })
]);

const WEATHER_SECONDS = 22;
const TRANSITION_SECONDS = 4;

function smoothstep(value) {
  return value * value * (3 - 2 * value);
}

export function weatherState(tick, tickRate = 60) {
  const elapsed = Math.max(0, tick) / tickRate;
  const phase = Math.floor(elapsed / WEATHER_SECONDS) % WEATHER_THEMES.length;
  const phaseSeconds = elapsed % WEATHER_SECONDS;
  const rawMix = Math.max(0, (phaseSeconds - (WEATHER_SECONDS - TRANSITION_SECONDS)) / TRANSITION_SECONDS);
  return {
    current: WEATHER_THEMES[phase],
    next: WEATHER_THEMES[(phase + 1) % WEATHER_THEMES.length],
    mix: smoothstep(rawMix)
  };
}

export function mixHex(first, second, amount) {
  const mix = Math.max(0, Math.min(1, amount));
  const parse = (color, offset) => Number.parseInt(color.slice(offset, offset + 2), 16);
  const channel = (offset) => Math.round(parse(first, offset) + (parse(second, offset) - parse(first, offset)) * mix)
    .toString(16).padStart(2, "0");
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}
