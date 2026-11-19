import { format, isValid, parseISO } from "date-fns";

export function fmtMoney(
  value: number | string | null | undefined,
  options?: Intl.NumberFormatOptions,
) {
  const number = typeof value === "string" ? Number(value) : value;
  if (number == null || !Number.isFinite(number)) return "—";
  const minimumFractionDigits = options?.minimumFractionDigits ?? 0;
  const maximumFractionDigits =
    options?.maximumFractionDigits ?? minimumFractionDigits;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits,
    maximumFractionDigits,
    ...options,
  }).format(number);
}

export function fmtNumber(
  value: number | string | null | undefined,
  options?: Intl.NumberFormatOptions,
) {
  const number = typeof value === "string" ? Number(value) : value;
  if (number == null || !Number.isFinite(number)) return "—";

  return new Intl.NumberFormat("en-US", options).format(number);
}

export function fmtOrDash(value: unknown) {
  if (value == null) return "—";
  if (typeof value === "string" && value.trim() === "") return "—";
  return String(value);
}

export function fmtDate(
  value: string | Date | null | undefined,
  pattern = "MMM d, yyyy",
) {
  if (value == null) return "—";
  const date = typeof value === "string" ? parseISO(value) : value;
  return isValid(date) ? format(date, pattern) : "—";
}
