import type { LinkType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError, isPricingAdmin, type Actor } from "./actor";
import { writeAudit } from "./audit";
import { SENSITIVE_TOPICS, isValidDomain } from "./admin-sites";

/**
 * Bulk CSV import. This is how the catalog actually grows, so it is strict:
 * a dry run always comes first, unknown category slugs are errors rather than
 * auto-creates (otherwise a typo silently forks the taxonomy into "technology"
 * and "techonlogy"), and the commit is one transaction that rolls back whole.
 *
 * ADMIN only — it sets cost.
 */
function assertPricingAdmin(actor: Actor) {
  if (!isPricingAdmin(actor)) throw new NotFoundError();
}

export const EXPECTED_COLUMNS = [
  "domain",
  "country",
  "language",
  "categories",
  "cost",
  "price",
  "writing_price",
  "turnaround_days",
  "link_type",
  "max_links",
  "min_words",
  "guarantee_days",
  "accepts_sensitive",
  "publisher_name",
  "publisher_email",
  "publisher_telegram",
  "notes",
] as const;

export type ImportError = {
  /** 1-based line number in the file, counting the header as line 1. */
  line: number;
  domain: string | null;
  column: string | null;
  message: string;
};

export type ImportPreview = {
  created: number;
  updated: number;
  unchanged: number;
  errors: ImportError[];
  rows: ParsedRow[];
};

export type ImportResult = {
  created: number;
  updated: number;
  unchanged: number;
  errors: ImportError[];
};

type ParsedRow = {
  line: number;
  domain: string;
  country: string;
  language: string;
  categories: string[];
  costCents: number;
  priceCents: number;
  writingCents: number;
  turnaroundDays: number;
  linkType: LinkType;
  maxLinks: number;
  minWords: number;
  guaranteeDays: number;
  acceptsSensitive: string[];
  publisherName: string | null;
  publisherEmail: string | null;
  publisherTelegram: string | null;
  notes: string | null;
  outcome: "create" | "update" | "unchanged";
};

/** Minimal RFC4180-ish splitter: handles quoted fields and embedded commas. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else inQuotes = false;
      } else current += char;
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      out.push(current);
      current = "";
    } else current += char;
  }
  out.push(current);
  return out.map((v) => v.trim());
}

function parseMoney(raw: string, column: string, line: number, domain: string | null): number {
  const value = raw.trim();
  if (!value) throw makeError(line, domain, column, `${column} is required.`);
  if (!/^\d+(\.\d{1,2})?$/.test(value)) {
    throw makeError(line, domain, column, `${column} must be a positive number, got "${raw}".`);
  }
  const cents = Math.round(Number(value) * 100);
  if (!Number.isInteger(cents) || cents < 0) {
    throw makeError(line, domain, column, `${column} must be a positive number, got "${raw}".`);
  }
  return cents;
}

function parseInteger(
  raw: string,
  column: string,
  line: number,
  domain: string | null,
  fallback: number
): number {
  const value = raw.trim();
  if (!value) return fallback;
  if (!/^\d+$/.test(value)) {
    throw makeError(line, domain, column, `${column} must be a whole number, got "${raw}".`);
  }
  return Number(value);
}

class RowError extends Error {
  constructor(public detail: ImportError) {
    super(detail.message);
  }
}

function makeError(
  line: number,
  domain: string | null,
  column: string | null,
  message: string
): RowError {
  return new RowError({ line, domain, column, message });
}

const LINK_TYPES: LinkType[] = ["DOFOLLOW", "NOFOLLOW", "SPONSORED", "MIXED"];

async function parseCsv(csv: string): Promise<{ rows: ParsedRow[]; errors: ImportError[] }> {
  const lines = csv.split(/\r?\n/).filter((l, i) => l.trim() !== "" || i === 0);
  if (lines.length === 0) return { rows: [], errors: [] };

  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const missing = ["domain", "country", "language", "cost", "price"].filter(
    (c) => !header.includes(c)
  );
  if (missing.length > 0) {
    return {
      rows: [],
      errors: [
        {
          line: 1,
          domain: null,
          column: missing[0],
          message: `Missing required column(s): ${missing.join(", ")}.`,
        },
      ],
    };
  }

  const index = (name: string) => header.indexOf(name);
  const at = (cols: string[], name: string) => {
    const i = index(name);
    return i === -1 ? "" : (cols[i] ?? "");
  };

  const knownCategories = new Set(
    (await prisma.category.findMany({ select: { slug: true } })).map((c) => c.slug)
  );

  const rows: ParsedRow[] = [];
  const errors: ImportError[] = [];
  const seenDomains = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
    const line = i + 1; // header is line 1
    const cols = splitCsvLine(lines[i]);
    const domainRaw = at(cols, "domain").toLowerCase();

    try {
      if (!domainRaw) throw makeError(line, null, "domain", "domain is required.");
      if (!isValidDomain(domainRaw)) {
        throw makeError(line, domainRaw, "domain", `"${domainRaw}" is not a valid domain.`);
      }
      if (seenDomains.has(domainRaw)) {
        throw makeError(line, domainRaw, "domain", `"${domainRaw}" appears more than once in this file.`);
      }
      seenDomains.add(domainRaw);

      const country = at(cols, "country").toUpperCase();
      if (!/^[A-Z]{2}$/.test(country)) {
        throw makeError(
          line,
          domainRaw,
          "country",
          `country must be an ISO-3166-1 alpha-2 code, got "${at(cols, "country")}".`
        );
      }

      const language = at(cols, "language").toLowerCase();
      if (!/^[a-z]{2}$/.test(language)) {
        throw makeError(
          line,
          domainRaw,
          "language",
          `language must be an ISO-639-1 code, got "${at(cols, "language")}".`
        );
      }

      const categories = at(cols, "categories")
        .split(";")
        .map((c) => c.trim().toLowerCase())
        .filter(Boolean);

      for (const slug of categories) {
        if (!knownCategories.has(slug)) {
          throw makeError(
            line,
            domainRaw,
            "categories",
            `unknown category slug "${slug}". Categories are never auto-created — add it first or fix the typo.`
          );
        }
      }

      const acceptsSensitive = at(cols, "accepts_sensitive")
        .split(";")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

      for (const topic of acceptsSensitive) {
        if (!SENSITIVE_TOPICS.includes(topic)) {
          throw makeError(
            line,
            domainRaw,
            "accepts_sensitive",
            `"${topic}" is not a known restricted topic.`
          );
        }
      }

      const costCents = parseMoney(at(cols, "cost"), "cost", line, domainRaw);
      const priceCents = parseMoney(at(cols, "price"), "price", line, domainRaw);
      if (priceCents <= costCents) {
        throw makeError(
          line,
          domainRaw,
          "price",
          `price (${priceCents}) must be above cost (${costCents}).`
        );
      }

      const linkTypeRaw = (at(cols, "link_type") || "DOFOLLOW").toUpperCase();
      if (!LINK_TYPES.includes(linkTypeRaw as LinkType)) {
        throw makeError(line, domainRaw, "link_type", `unknown link_type "${linkTypeRaw}".`);
      }

      rows.push({
        line,
        domain: domainRaw,
        country,
        language,
        categories,
        costCents,
        priceCents,
        writingCents: at(cols, "writing_price")
          ? parseMoney(at(cols, "writing_price"), "writing_price", line, domainRaw)
          : 0,
        turnaroundDays: parseInteger(at(cols, "turnaround_days"), "turnaround_days", line, domainRaw, 7),
        linkType: linkTypeRaw as LinkType,
        maxLinks: parseInteger(at(cols, "max_links"), "max_links", line, domainRaw, 2),
        minWords: parseInteger(at(cols, "min_words"), "min_words", line, domainRaw, 700),
        guaranteeDays: parseInteger(at(cols, "guarantee_days"), "guarantee_days", line, domainRaw, 90),
        acceptsSensitive,
        publisherName: at(cols, "publisher_name") || null,
        publisherEmail: at(cols, "publisher_email") || null,
        publisherTelegram: at(cols, "publisher_telegram") || null,
        notes: at(cols, "notes") || null,
        outcome: "create",
      });
    } catch (err) {
      if (err instanceof RowError) errors.push(err.detail);
      else throw err;
    }
  }

  return { rows, errors };
}

/** Classifies each row against what is already in the catalog. */
async function classify(rows: ParsedRow[]) {
  if (rows.length === 0) return rows;

  const existing = await prisma.site.findMany({
    where: { domain: { in: rows.map((r) => r.domain) } },
    select: {
      domain: true,
      country: true,
      language: true,
      costCents: true,
      priceCents: true,
      writingCents: true,
      turnaroundDays: true,
      linkType: true,
      maxLinks: true,
      minWords: true,
      guaranteeDays: true,
      acceptsSensitive: true,
    },
  });
  const byDomain = new Map(existing.map((e) => [e.domain, e]));

  for (const row of rows) {
    const current = byDomain.get(row.domain);
    if (!current) {
      row.outcome = "create";
      continue;
    }

    const same =
      current.country === row.country &&
      current.language === row.language &&
      current.costCents === row.costCents &&
      current.priceCents === row.priceCents &&
      current.writingCents === row.writingCents &&
      current.turnaroundDays === row.turnaroundDays &&
      current.linkType === row.linkType &&
      current.maxLinks === row.maxLinks &&
      current.minWords === row.minWords &&
      current.guaranteeDays === row.guaranteeDays &&
      [...current.acceptsSensitive].sort().join(",") === [...row.acceptsSensitive].sort().join(",");

    row.outcome = same ? "unchanged" : "update";
  }

  return rows;
}

export async function dryRunImport(actor: Actor, csv: string): Promise<ImportPreview> {
  assertPricingAdmin(actor);

  const { rows, errors } = await parseCsv(csv);
  const classified = await classify(rows);

  return {
    created: classified.filter((r) => r.outcome === "create").length,
    updated: classified.filter((r) => r.outcome === "update").length,
    unchanged: classified.filter((r) => r.outcome === "unchanged").length,
    errors,
    rows: classified,
  };
}

export async function commitImport(
  actor: Actor,
  csv: string,
  fileName: string
): Promise<ImportResult> {
  assertPricingAdmin(actor);

  const preview = await dryRunImport(actor, csv);

  // Nothing is written when any row is bad — a partial catalog import is worse
  // than none, because nobody can tell which half landed.
  if (preview.errors.length > 0) {
    const first = preview.errors[0];
    throw new ValidationError(
      `Import refused: ${preview.errors.length} row(s) have errors. ` +
        `First problem on line ${first.line}${first.domain ? ` (${first.domain})` : ""}: ${first.message}`
    );
  }

  if (preview.rows.length === 0) {
    throw new ValidationError("That file contains no rows to import.");
  }

  const categorySlugs = [...new Set(preview.rows.flatMap((r) => r.categories))];
  const categories = await prisma.category.findMany({
    where: { slug: { in: categorySlugs } },
    select: { id: true, slug: true },
  });
  const categoryIdBySlug = new Map(categories.map((c) => [c.slug, c.id]));

  await prisma.$transaction(async (tx) => {
    for (const row of preview.rows) {
      let publisherId: string | null = null;
      if (row.publisherName) {
        // Publishers are matched by name and created if new, unlike categories:
        // a new publisher is expected during import, a new category is a typo.
        const existing = await tx.publisher.findFirst({
          where: { name: row.publisherName },
          select: { id: true },
        });
        publisherId =
          existing?.id ??
          (
            await tx.publisher.create({
              data: {
                name: row.publisherName,
                email: row.publisherEmail,
                telegram: row.publisherTelegram,
              },
              select: { id: true },
            })
          ).id;
      }

      const data = {
        country: row.country,
        language: row.language,
        costCents: row.costCents,
        priceCents: row.priceCents,
        writingCents: row.writingCents,
        turnaroundDays: row.turnaroundDays,
        linkType: row.linkType,
        maxLinks: row.maxLinks,
        minWords: row.minWords,
        guaranteeDays: row.guaranteeDays,
        acceptsSensitive: row.acceptsSensitive,
        description: row.notes,
        ...(publisherId ? { publisherId } : {}),
      } satisfies Prisma.SiteUncheckedUpdateInput;

      const site = await tx.site.upsert({
        where: { domain: row.domain },
        create: { domain: row.domain, ...data },
        update: data,
        select: { id: true },
      });

      if (row.categories.length > 0) {
        await tx.categoryOnSite.deleteMany({ where: { siteId: site.id } });
        await tx.categoryOnSite.createMany({
          data: row.categories.map((slug) => ({
            siteId: site.id,
            categoryId: categoryIdBySlug.get(slug)!,
          })),
          skipDuplicates: true,
        });
      }
    }

    const log = await tx.importLog.create({
      data: {
        actorUserId: actor.id,
        fileName,
        createdCount: preview.created,
        updatedCount: preview.updated,
        unchangedCount: preview.unchanged,
        errorCount: 0,
      },
    });

    // One audit row for the import as a whole, not one per row.
    await writeAudit(tx, actor, {
      action: "catalog.import",
      entityType: "Import",
      entityId: log.id,
      before: null,
      after: {
        fileName,
        created: preview.created,
        updated: preview.updated,
        unchanged: preview.unchanged,
      },
    });
  });

  return {
    created: preview.created,
    updated: preview.updated,
    unchanged: preview.unchanged,
    errors: [],
  };
}

export async function listImports(actor: Actor) {
  assertPricingAdmin(actor);
  return prisma.importLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      fileName: true,
      createdCount: true,
      updatedCount: true,
      unchangedCount: true,
      errorCount: true,
      createdAt: true,
      actor: { select: { email: true } },
    },
  });
}
