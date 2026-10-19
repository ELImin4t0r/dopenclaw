/**
 * Pure logic for library places, reservations and the check-in gate.
 *
 * Check-in is only allowed when a fresh phone location puts you inside the
 * library: KURT check-in exists to confirm you're actually at your seat.
 */
import { formatAlertLine } from "./format.js";

export type Place = { name: string; lat: number; lon: number; radiusM: number };

export type Reservation = {
  id: string;
  /** Library / building name as KURT shows it, e.g. "Agora". */
  location: string;
  seat: string;
  startMs: number;
  endMs: number;
  checkedIn: boolean;
};

export type PhoneLocation = { lat: number; lon: number; accuracyMeters: number; timestampMs: number };

export type CheckinWindow = { beforeMinutes: number; afterMinutes: number };

export type GateResult =
  | { ok: true; reservation: Reservation; place: Place }
  | { ok: false; reason: string };

export const MAX_LOCATION_AGE_MS = 5 * 60_000;
export const MAX_LOCATION_ACCURACY_M = 100;

const PLACE_LINE = /^- ([^|]+?) \| (-?\d+(?:\.\d+)?), ?(-?\d+(?:\.\d+)?)(?: \| (\d+))?$/;

/** `personal/places.md` lines: `- Agora | 50.8786, 4.7031 | 80` (radius in metres, default 75). */
export function parsePlaces(markdown: string): Place[] {
  const places: Place[] = [];
  for (const line of markdown.split("\n")) {
    const m = PLACE_LINE.exec(line.trim());
    if (m) {
      places.push({ name: m[1].trim(), lat: Number(m[2]), lon: Number(m[3]), radiusM: m[4] ? Number(m[4]) : 75 });
    }
  }
  return places;
}

export function distanceMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

export function placeFor(reservation: Reservation, places: Place[]): Place | undefined {
  const location = reservation.location.toLowerCase();
  return places.find((p) => location.includes(p.name.toLowerCase()));
}

export function inWindow(r: Reservation, nowMs: number, w: CheckinWindow): boolean {
  return nowMs >= r.startMs - w.beforeMinutes * 60_000 && nowMs <= r.startMs + w.afterMinutes * 60_000;
}

export function evaluateCheckin(params: {
  reservations: Reservation[];
  places: Place[];
  location: PhoneLocation | undefined;
  nowMs: number;
  window: CheckinWindow;
}): GateResult {
  const { location, nowMs } = params;
  const reservation = params.reservations.find((r) => !r.checkedIn && inWindow(r, nowMs, params.window));
  if (!reservation) {
    return { ok: false, reason: "No reservation is open for check-in right now." };
  }
  const place = placeFor(reservation, params.places);
  if (!place) {
    return {
      ok: false,
      reason: `No coordinates for "${reservation.location}". Add it to personal/places.md.`,
    };
  }
  if (!location) {
    return { ok: false, reason: "No phone location available." };
  }
  if (nowMs - location.timestampMs > MAX_LOCATION_AGE_MS) {
    return { ok: false, reason: "Phone location is older than 5 minutes." };
  }
  if (location.accuracyMeters > MAX_LOCATION_ACCURACY_M) {
    return { ok: false, reason: `Phone location is too imprecise (±${Math.round(location.accuracyMeters)} m).` };
  }
  const distance = distanceMeters(location, place);
  if (distance > place.radiusM) {
    return { ok: false, reason: `You're ${Math.round(distance)} m from ${place.name}; check-in needs you there.` };
  }
  return { ok: true, reservation, place };
}

export function renderReservations(reservations: Reservation[], syncedAtMs: number): string {
  const lines = [`# Library reservations`, ``, `Last synced: ${new Date(syncedAtMs).toLocaleString("en-GB")}`, ``];
  if (reservations.length === 0) {
    lines.push("No upcoming reservations.");
  }
  for (const r of [...reservations].sort((a, b) => a.startMs - b.startMs)) {
    const fmt = (ms: number) => new Date(ms).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });
    lines.push(
      `- ${fmt(r.startMs)}–${new Date(r.endMs).toLocaleTimeString("en-GB", { timeStyle: "short" })} · ${r.location} · ${r.seat}${r.checkedIn ? " · ✅ checked in" : ""}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

/** Alert lines consumed by the daily-briefing plugin (`personal/alerts/kurt.md`). */
export function renderReservationAlerts(reservations: Reservation[], leadMinutes: number): string {
  const lines = ["# KURT alerts (generated, overwritten on every sync)", ""];
  for (const r of reservations.filter((x) => !x.checkedIn)) {
    lines.push(formatAlertLine(r.startMs - leadMinutes * 60_000, `Library in ${leadMinutes} min`, `${r.location} · ${r.seat}`));
    lines.push(formatAlertLine(r.startMs, "Check in at the library", `${r.location} · ${r.seat}`));
  }
  return `${lines.join("\n")}\n`;
}
