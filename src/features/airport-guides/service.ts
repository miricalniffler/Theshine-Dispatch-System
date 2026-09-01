import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { airportGuidePublicUrl } from "./storage";
import { normalizeAirportText, type AirportGuideMatchCandidate } from "./matcher";
import type { AirportGuideInput, AirportGuideView, RegionNotificationSettingView } from "./types";

const stringList = z.array(z.string().trim().min(2).max(120)).max(30).default([]);
export const airportGuideInputSchema = z.object({
  airportName: z.string().trim().min(2).max(120),
  iataCode: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional().nullable(),
  terminal: z.string().trim().max(80).optional().nullable(),
  guideText: z.string().trim().min(1).max(12_000),
  isActive: z.boolean().default(true),
  aliases: stringList,
  addressKeywords: stringList,
});

export class AirportGuideServiceError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

type GuideRow = Prisma.AirportGuideGetPayload<{ include: { aliases: true; images: { orderBy: { sortOrder: "asc" } } } }>;

function cleanList(values: string[]): { normalizedValue: string; value: string }[] {
  const entries = values.map((value) => ({ normalizedValue: normalizeAirportText(value), value: value.trim() })).filter((item) => item.normalizedValue.length >= 2);
  return [...new Map<string, string>(entries.map((item) => [item.normalizedValue, item.value] as const))].map(([normalizedValue, value]) => ({ normalizedValue, value }));
}

function cleanIata(value?: string | null) { return value?.trim().toUpperCase() || null; }
function cleanOptional(value?: string | null) { return value?.trim() || null; }

export function airportGuideMatchKey(input: Pick<AirportGuideInput, "airportName" | "iataCode" | "terminal">) {
  const terminal = normalizeAirportText(input.terminal || "") || "-";
  const iata = cleanIata(input.iataCode);
  return iata ? `IATA:${iata}|TERMINAL:${terminal}` : `NAME:${normalizeAirportText(input.airportName)}|TERMINAL:${terminal}`;
}

function toView(row: GuideRow): AirportGuideView {
  return {
    id: row.id,
    airportName: row.airportName,
    iataCode: row.iataCode,
    terminal: row.terminal,
    guideText: row.guideText,
    isActive: row.isActive,
    deactivatedAt: row.deactivatedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    aliases: row.aliases.filter((alias) => alias.matchKind === "ALIAS").map((alias) => alias.value),
    addressKeywords: row.aliases.filter((alias) => alias.matchKind === "ADDRESS_KEYWORD").map((alias) => alias.value),
    images: row.images.map((image) => ({ id: image.id, originalFilename: image.originalFilename, mimeType: image.mimeType, byteSize: image.byteSize, sortOrder: image.sortOrder, publicUrl: airportGuidePublicUrl(image.storageBucket, image.storagePath) })),
  };
}

function guideInclude() { return { aliases: true, images: { orderBy: { sortOrder: "asc" as const } } }; }

async function ensureNoActiveAliasConflict(tx: Prisma.TransactionClient, input: AirportGuideInput, excludedGuideId?: string, replacementMatchKey?: string) {
  const normalizedValues = [...cleanList(input.aliases), ...cleanList(input.addressKeywords)].map((item) => item.normalizedValue);
  if (!normalizedValues.length || !input.isActive) return;
  const conflict = await tx.airportGuide.findFirst({
    where: { isActive: true, ...(excludedGuideId ? { id: { not: excludedGuideId } } : {}), aliases: { some: { normalizedValue: { in: normalizedValues } } } },
    select: { airportName: true, matchKey: true },
  });
  // A newly created version with the same matchKey replaces the old active
  // version in this transaction. Other active guides still cannot share aliases.
  if (conflict && conflict.matchKey !== replacementMatchKey) throw new AirportGuideServiceError("MATCH_CONFLICT", `识别关键词已被有效指引“${conflict.airportName}”使用，请先停用或修改其中一个版本。`);
}

function aliasCreateData(input: AirportGuideInput) {
  return [
    ...cleanList(input.aliases).map((alias) => ({ matchKind: "ALIAS", value: alias.value, normalizedValue: alias.normalizedValue })),
    ...cleanList(input.addressKeywords).map((alias) => ({ matchKind: "ADDRESS_KEYWORD", value: alias.value, normalizedValue: alias.normalizedValue })),
  ];
}

function normalInput(input: AirportGuideInput): AirportGuideInput {
  const iataCode = cleanIata(input.iataCode);
  const terminal = cleanOptional(input.terminal);
  return { ...input, airportName: input.airportName.trim(), iataCode, terminal, guideText: input.guideText.trim(), aliases: input.aliases.map((item) => item.trim()).filter(Boolean), addressKeywords: input.addressKeywords.map((item) => item.trim()).filter(Boolean) };
}

export async function listAirportGuides() {
  const rows = await db.airportGuide.findMany({ include: guideInclude(), orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }] });
  return rows.map(toView);
}

export async function getAirportGuide(id: string) {
  const row = await db.airportGuide.findUnique({ where: { id }, include: guideInclude() });
  return row ? toView(row) : null;
}

export async function createAirportGuide(rawInput: AirportGuideInput) {
  const input = normalInput(rawInput);
  const matchKey = airportGuideMatchKey(input);
  const row = await db.$transaction(async (tx) => {
    await ensureNoActiveAliasConflict(tx, input, undefined, matchKey);
    if (input.isActive) await tx.airportGuide.updateMany({ where: { matchKey, isActive: true }, data: { isActive: false, deactivatedAt: new Date() } });
    return tx.airportGuide.create({ data: { airportName: input.airportName, iataCode: input.iataCode, terminal: input.terminal, matchKey, guideText: input.guideText, isActive: input.isActive, deactivatedAt: input.isActive ? null : new Date(), aliases: { create: aliasCreateData(input) }, }, include: guideInclude() });
  });
  return toView(row as GuideRow);
}

export async function updateAirportGuide(id: string, rawInput: AirportGuideInput) {
  const input = normalInput(rawInput);
  const matchKey = airportGuideMatchKey(input);
  const row = await db.$transaction(async (tx) => {
    const existing = await tx.airportGuide.findUnique({ where: { id } });
    if (!existing) throw new AirportGuideServiceError("NOT_FOUND", "找不到机场指引。 ");
    await ensureNoActiveAliasConflict(tx, input, id, matchKey);
    if (input.isActive) await tx.airportGuide.updateMany({ where: { id: { not: id }, matchKey, isActive: true }, data: { isActive: false, deactivatedAt: new Date() } });
    await tx.airportGuideAlias.deleteMany({ where: { airportGuideId: id } });
    return tx.airportGuide.update({ where: { id }, data: { airportName: input.airportName, iataCode: input.iataCode, terminal: input.terminal, matchKey, guideText: input.guideText, isActive: input.isActive, deactivatedAt: input.isActive ? null : new Date(), aliases: { create: aliasCreateData(input) } }, include: guideInclude() });
  });
  return toView(row as GuideRow);
}

export async function setAirportGuideActive(id: string, isActive: boolean) {
  const existing = await db.airportGuide.findUnique({ where: { id } });
  if (!existing) throw new AirportGuideServiceError("NOT_FOUND", "找不到机场指引。 ");
  return updateAirportGuide(id, { airportName: existing.airportName, iataCode: existing.iataCode, terminal: existing.terminal, guideText: existing.guideText, isActive, aliases: (await db.airportGuideAlias.findMany({ where: { airportGuideId: id, matchKind: "ALIAS" } })).map((item) => item.value), addressKeywords: (await db.airportGuideAlias.findMany({ where: { airportGuideId: id, matchKind: "ADDRESS_KEYWORD" } })).map((item) => item.value) });
}

export async function activeAirportGuideCandidates(): Promise<AirportGuideMatchCandidate[]> {
  const rows = await db.airportGuide.findMany({ include: { aliases: true } });
  return rows.map((row) => ({ id: row.id, airportName: row.airportName, iataCode: row.iataCode, terminal: row.terminal, isActive: row.isActive, aliases: row.aliases.map((alias) => ({ matchKind: alias.matchKind as "ALIAS" | "ADDRESS_KEYWORD", normalizedValue: alias.normalizedValue })) }));
}

const defaultRegions = [
  { region: "曼谷", customerWhatsAppEnabled: true },
  { region: "苏梅", customerWhatsAppEnabled: false },
];

export async function listRegionNotificationSettings(): Promise<RegionNotificationSettingView[]> {
  await db.regionNotificationSetting.createMany({ data: defaultRegions, skipDuplicates: true });
  const rows = await db.regionNotificationSetting.findMany({ orderBy: { region: "asc" } });
  return rows.map((row) => ({ region: row.region, customerWhatsAppEnabled: row.customerWhatsAppEnabled, updatedAt: row.updatedAt.toISOString() }));
}

export async function updateRegionNotificationSetting(region: string, customerWhatsAppEnabled: boolean) {
  const row = await db.regionNotificationSetting.upsert({ where: { region }, create: { region, customerWhatsAppEnabled }, update: { customerWhatsAppEnabled } });
  return { region: row.region, customerWhatsAppEnabled: row.customerWhatsAppEnabled, updatedAt: row.updatedAt.toISOString() };
}
