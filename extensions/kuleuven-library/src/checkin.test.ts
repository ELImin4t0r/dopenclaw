import { describe, expect, it } from "vitest";
import {
  distanceMeters,
  evaluateCheckin,
  parsePlaces,
  renderReservationAlerts,
  type PhoneLocation,
  type Reservation,
} from "./checkin.js";

const AGORA = { name: "Agora", lat: 50.8786, lon: 4.7031, radiusM: 80 };
const NOW = new Date(2026, 9, 20, 13, 55).getTime();
const window = { beforeMinutes: 15, afterMinutes: 30 };

const reservation: Reservation = {
  id: "r1",
  location: "Agora Learning Centre",
  seat: "Seat 12",
  startMs: new Date(2026, 9, 20, 14, 0).getTime(),
  endMs: new Date(2026, 9, 20, 18, 0).getTime(),
  checkedIn: false,
};

const atAgora: PhoneLocation = { lat: 50.8787, lon: 4.7032, accuracyMeters: 15, timestampMs: NOW - 30_000 };

function gate(overrides: Partial<Parameters<typeof evaluateCheckin>[0]> = {}) {
  return evaluateCheckin({ reservations: [reservation], places: [AGORA], location: atAgora, nowMs: NOW, window, ...overrides });
}

describe("parsePlaces", () => {
  it("reads name, coordinates and optional radius", () => {
    expect(parsePlaces("# Places\n- Agora | 50.8786, 4.7031 | 80\n- CBA | 50.87,4.70\nnot a place")).toEqual([
      AGORA,
      { name: "CBA", lat: 50.87, lon: 4.7, radiusM: 75 },
    ]);
  });
});

describe("evaluateCheckin", () => {
  it("allows check-in at the library inside the window", () => {
    expect(gate()).toMatchObject({ ok: true, place: { name: "Agora" } });
  });

  it("refuses when the phone is elsewhere", () => {
    const home = { ...atAgora, lat: 50.87, lon: 4.69 };
    expect(distanceMeters(home, AGORA)).toBeGreaterThan(1000);
    expect(gate({ location: home })).toMatchObject({ ok: false });
  });

  it("refuses without a location, with a stale one, or an imprecise one", () => {
    expect(gate({ location: undefined })).toMatchObject({ ok: false });
    expect(gate({ location: { ...atAgora, timestampMs: NOW - 6 * 60_000 } })).toMatchObject({ ok: false });
    expect(gate({ location: { ...atAgora, accuracyMeters: 500 } })).toMatchObject({ ok: false });
  });

  it("refuses outside the check-in window and for already-checked-in reservations", () => {
    expect(gate({ nowMs: reservation.startMs - 20 * 60_000 })).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/^No reservation/),
    });
    expect(gate({ nowMs: reservation.startMs + 31 * 60_000 })).toMatchObject({ ok: false });
    expect(gate({ reservations: [{ ...reservation, checkedIn: true }] })).toMatchObject({ ok: false });
  });

  it("refuses when the library has no coordinates", () => {
    expect(gate({ places: [] })).toMatchObject({ ok: false, reason: expect.stringContaining("places.md") });
  });
});

describe("renderReservationAlerts", () => {
  it("emits a heads-up and a check-in alert per open reservation", () => {
    const md = renderReservationAlerts([reservation, { ...reservation, id: "r2", checkedIn: true }], 30);
    expect(md).toContain("- 2026-10-20 13:30 | Library in 30 min | Agora Learning Centre · Seat 12");
    expect(md).toContain("- 2026-10-20 14:00 | Check in at the library | Agora Learning Centre · Seat 12");
    expect(md.match(/^- /gm)).toHaveLength(2);
  });
});
