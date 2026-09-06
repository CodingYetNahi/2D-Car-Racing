export const DEFAULT_SKIN = "neon";
export const SKINS = Object.freeze(["neon", "sunset", "royal"]);
export const SKIN_STORAGE_KEY = "racingSelectedSkin";

export function isKnownSkin(value) {
  return typeof value === "string" && SKINS.includes(value);
}

// A saved cosmetic preference is never an entitlement. The caller must supply
// a pass that has just been verified by the payment service.
export function resolveSelectedSkin(savedValue, hasServerVerifiedPass) {
  return hasServerVerifiedPass && isKnownSkin(savedValue) ? savedValue : DEFAULT_SKIN;
}
