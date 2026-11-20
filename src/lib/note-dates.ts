export type NoteDate = {
  label: string;
  date_text: string;
  iso_guess: string;
};

const labeledDatePattern =
  /(?:^|[^\w])(due\s+diligence|closing|close|dd|deadline|deposit|expires|loi|psa)(?:[\s,:-]+[\w'-]+){0,3}[\s,:-]*$/i;

export function extractNoteDates(
  notes: string | null,
  reference: Date,
): NoteDate[] {
  if (!notes) return [];

  const datePattern = /\b(\d{1,2}\/\d{1,2}(?:\/\d{2}(?:\d{2})?)?)\b/g;
  const dates: NoteDate[] = [];

  for (const match of notes.matchAll(datePattern)) {
    const dateText = match[1];
    if (!dateText || match.index === undefined) continue;

    const precedingText = notes
      .slice(0, match.index)
      .split(/[\n.!?;]/)
      .at(-1);
    const label = precedingText?.match(labeledDatePattern)?.[1];
    if (!label) continue;

    const [monthText, dayText, yearText] = dateText.split("/");
    const month = Number(monthText);
    const day = Number(dayText);
    const yearless = yearText === undefined;
    let year = yearless
      ? reference.getUTCFullYear()
      : Number(yearText) + (yearText.length === 2 ? 2000 : 0);

    let date = validDate(year, month, day);
    if (!date) continue;

    if (
      yearless &&
      date.getTime() <
        Date.UTC(
          reference.getUTCFullYear(),
          reference.getUTCMonth(),
          reference.getUTCDate(),
        )
    ) {
      year += 1;
      date = validDate(year, month, day);
      if (!date) continue;
    }

    dates.push({
      label,
      date_text: dateText,
      iso_guess: date.toISOString().slice(0, 10),
    });
  }

  return dates;
}

function validDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : null;
}
