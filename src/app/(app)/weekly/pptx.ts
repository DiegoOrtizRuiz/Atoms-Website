"use client";

import PptxGenJS from "pptxgenjs";
import type { WeeklyModel, WeeklyRow } from "@/lib/weekly";
import { fmtMoney, fmtNumber } from "@/lib/format";

const COLORS = {
  navy: "0F172A",
  cyan: "0891B2",
  slate: "475569",
  light: "F1F5F9",
  border: "CBD5E1",
  amber: "B45309",
  violet: "7C3AED",
};

function compactMoney(value: number | null) {
  if (value == null) return "—";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return fmtMoney(value);
}

function tableRow(row: WeeklyRow) {
  return [
    { text: row.market || "—" },
    {
      text: [row.address || "—", row.location].filter(Boolean).join("\n"),
      options: { italic: Boolean(row.fieldProvenance.address) },
    },
    {
      text: row.stage,
      options: { italic: Boolean(row.fieldProvenance.stage) },
    },
    {
      text: compactMoney(row.listPrice),
      options: { italic: Boolean(row.fieldProvenance.list_price) },
    },
    { text: fmtNumber(row.buildingSf) },
    { text: row.pricePerSf == null ? "—" : `$${row.pricePerSf}/SF` },
    { text: fmtNumber(row.lotSf) },
    {
      text: row.notes || "—",
      options: { italic: Boolean(row.fieldProvenance.weekly_note) },
    },
  ];
}

export async function exportWeeklyPptx(model: WeeklyModel) {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Site Pipeline";
  pptx.subject = "Acquisition pipeline weekly review";
  pptx.title = `Pipeline Review — week of ${model.weekStart}`;
  pptx.company = "S&P Real Estate";
  pptx.theme = {
    headFontFace: "Aptos Display",
    bodyFontFace: "Aptos",
  };

  const title = pptx.addSlide();
  title.background = { color: COLORS.navy };
  title.addText("PIPELINE REVIEW", {
    x: 0.7,
    y: 0.65,
    w: 3.5,
    h: 0.35,
    color: "67E8F9",
    bold: true,
    charSpacing: 2.4,
    fontSize: 14,
  });
  title.addText(`Week of ${model.weekStart}`, {
    x: 0.7,
    y: 1.15,
    w: 10.5,
    h: 0.8,
    color: "FFFFFF",
    bold: true,
    fontSize: 34,
  });
  title.addText("One live dataset · operations to leadership", {
    x: 0.72,
    y: 2.03,
    w: 8,
    h: 0.35,
    color: "CBD5E1",
    fontSize: 17,
  });
  model.sections.forEach((section, index) => {
    const x = 0.72 + index * 4.05;
    title.addShape(pptx.ShapeType.roundRect, {
      x,
      y: 3.4,
      w: 3.7,
      h: 2.15,
      fill: { color: "172033" },
      line: { color: "334155" },
    });
    title.addText(section.vertical, {
      x: x + 0.25,
      y: 3.7,
      w: 3.2,
      h: 0.35,
      color: "FFFFFF",
      bold: true,
      fontSize: 17,
    });
    title.addText(`${section.rows.length} deals`, {
      x: x + 0.25,
      y: 4.18,
      w: 3.2,
      h: 0.4,
      color: "67E8F9",
      fontSize: 24,
      bold: true,
    });
    const stages = Object.entries(section.counts)
      .map(([stage, count]) => `${count} ${stage}`)
      .join(" · ");
    title.addText(stages || "—", {
      x: x + 0.25,
      y: 4.75,
      w: 3.2,
      h: 0.48,
      color: "CBD5E1",
      fontSize: 10,
      breakLine: false,
    });
  });

  const attention = pptx.addSlide();
  attention.background = { color: "FFFFFF" };
  attention.addText("Needs attention this week", {
    x: 0.65,
    y: 0.5,
    w: 12,
    h: 0.55,
    color: COLORS.navy,
    bold: true,
    fontSize: 27,
  });
  if (model.attention.length) {
    attention.addText(
      model.attention.map((item) => ({
        text: `${item.label} — ${item.detail}`,
        options: { bullet: { indent: 16 }, breakLine: true },
      })),
      {
        x: 0.85,
        y: 1.45,
        w: 11.6,
        h: 5.2,
        color: COLORS.slate,
        fontSize: 19,
        breakLine: false,
        valign: "top",
      },
    );
  } else {
    attention.addText("No stage moves, new deals, or upcoming key dates.", {
      x: 0.85,
      y: 2.3,
      w: 11.5,
      h: 0.7,
      color: COLORS.slate,
      fontSize: 22,
    });
  }

  for (const section of model.sections) {
    const chunks = Array.from(
      { length: Math.max(1, Math.ceil(section.rows.length / 8)) },
      (_, index) => section.rows.slice(index * 8, index * 8 + 8),
    );
    chunks.forEach((rows, chunkIndex) => {
      const slide = pptx.addSlide();
      slide.background = { color: "FFFFFF" };
      slide.addText(section.vertical, {
        x: 0.55,
        y: 0.35,
        w: 9,
        h: 0.45,
        color: COLORS.navy,
        bold: true,
        fontSize: 25,
      });
      slide.addText(
        `${rows.length} of ${section.rows.length}${chunks.length > 1 ? ` · page ${chunkIndex + 1}/${chunks.length}` : ""}`,
        {
          x: 10.4,
          y: 0.42,
          w: 2.25,
          h: 0.3,
          color: COLORS.slate,
          align: "right",
          fontSize: 11,
        },
      );
      slide.addTable(
        [
          [
            { text: "Market" },
            { text: "Address" },
            { text: "Status" },
            { text: "$" },
            { text: "SF" },
            { text: "$/SF" },
            { text: "Lot size" },
            { text: "Notes" },
          ],
          ...rows.map(tableRow),
        ],
        {
          x: 0.45,
          y: 1.05,
          w: 12.4,
          h: 5.45,
          border: { color: COLORS.border, pt: 0.5 },
          fill: { color: "FFFFFF" },
          color: COLORS.navy,
          fontFace: "Aptos",
          fontSize: 9,
          margin: 0.07,
          rowH: 0.55,
          colW: [1.0, 2.1, 1.3, 1.0, 0.85, 0.85, 0.9, 4.4],
          bold: false,
          valign: "middle",
        },
      );
      slide.addShape(pptx.ShapeType.line, {
        x: 0.45,
        y: 6.72,
        w: 12.4,
        h: 0,
        line: { color: COLORS.border, pt: 0.5 },
      });
      slide.addText(
        "● Assumed   ● LLM suggested — italic values remain to be confirmed",
        {
          x: 0.5,
          y: 6.85,
          w: 8,
          h: 0.22,
          color: COLORS.slate,
          fontSize: 9,
        },
      );
    });
  }

  await pptx.writeFile({ fileName: `pipeline-review-${model.weekStart}.pptx` });
}
