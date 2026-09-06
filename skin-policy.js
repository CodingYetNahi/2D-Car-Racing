export const DEFAULT_SKIN = "neon";
export const SKINS = Object.freeze(["neon", "sunset", "royal"]);
export const SKIN_STORAGE_KEY = "racingSelectedSkin";
export const SKIN_PAINTS = Object.freeze({
  neon: "#58e88b",
  sunset: "#ff6f61",
  royal: "#8d7bff"
});

export function isKnownSkin(value) {
  return typeof value === "string" && SKINS.includes(value);
}

// A saved cosmetic preference is never an entitlement. The caller must supply
// a pass that has just been verified by the payment service.
export function resolveSelectedSkin(savedValue, hasServerVerifiedPass) {
  return hasServerVerifiedPass && isKnownSkin(savedValue) ? savedValue : DEFAULT_SKIN;
}

export function normalizeServerPass(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.active !== true && value.authorized !== true && value.verified !== true) return null;
  if (typeof value.expiresAt !== "string" || !Number.isFinite(Date.parse(value.expiresAt))) return null;
  return { ...value, active: true };
}
