export const TERMS_VERSION = "2026-09-01";

export const PASS_PRODUCTS = Object.freeze({
  day: Object.freeze({ code: "day", name: "1 Day Pass", amountPaise: 2900, durationHours: 24 }),
  week: Object.freeze({ code: "week", name: "1 Week Pass", amountPaise: 9900, durationHours: 168 })
});

export const ENTITLEMENT_STORAGE_KEY = "racingAccessToken";

export function getPassProduct(code) {
  return Object.prototype.hasOwnProperty.call(PASS_PRODUCTS, code) ? PASS_PRODUCTS[code] : null;
}
