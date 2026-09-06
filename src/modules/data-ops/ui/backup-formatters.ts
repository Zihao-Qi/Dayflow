"use client";

import type { RestoreStatus } from "./backup-model";

export function stringField(value: RestoreStatus, field: string) {
  return typeof value[field] === "string" ? String(value[field]) : null;
}

export function formatDate(value: string | null) {
  if (!value) return "Unavailable";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

export function formatBytes(value: number | null) {
  if (value === null) return "Unavailable";
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let amount = value / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && amount >= 1024; index += 1) {
    amount /= 1024;
    unit = units[index];
  }
  return `${amount >= 10 ? amount.toFixed(0) : amount.toFixed(1)} ${unit}`;
}

export function formatInteger(value: number | null) {
  if (value === null) return "Unavailable";
  return new Intl.NumberFormat().format(value);
}

export function splitIdentifier(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ");
}

export function humanizeStatus(value: string) {
  return splitIdentifier(value.toLowerCase()).replace(/^\w/, (letter) =>
    letter.toUpperCase()
  );
}
