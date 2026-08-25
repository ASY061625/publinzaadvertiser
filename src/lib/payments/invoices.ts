import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { NotFoundError, type Actor } from "@/lib/data/actor";

/**
 * Invoices are issued on capture, immutable once issued, and numbered
 * sequentially without gaps. A correction is a credit note, never an edit.
 *
 * Buyer details are snapshotted at issue: updating a user's legal name later
 * must not silently change last year's invoice.
 */

const INVOICE_DIR = process.env.INVOICE_DIR ?? join(process.cwd(), "scratch", "invoices");

/**
 * Takes the next number under an atomic increment inside the caller's
 * transaction, so concurrent orders cannot claim the same number or skip one.
 */
async function nextNumber(
  tx: Prisma.TransactionClient,
  prefix: "INV" | "CN",
  year: number
): Promise<string> {
  const key = `${prefix.toLowerCase()}:${year}`;
  const counter = await tx.documentCounter.upsert({
    where: { key },
    create: { key, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
    select: { lastNumber: true },
  });
  return `${prefix}-${year}-${String(counter.lastNumber).padStart(5, "0")}`;
}

/**
 * Writes a minimal, self-contained PDF. Stored as bytes so the document can
 * never change: re-rendering on demand from live data is exactly how last
 * year's invoice silently changes when a name is updated.
 */
function renderPdf(lines: string[]): Buffer {
  const escape = (s: string) => s.replace(/([\\()])/g, "\\$1");
  const text = lines
    .map((line, i) => `BT /F1 11 Tf 56 ${760 - i * 18} Td (${escape(line)}) Tj ET`)
    .join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}

function formatMinor(amountMinor: number, currency: string): string {
  const sign = amountMinor < 0 ? "-" : "";
  const abs = Math.abs(amountMinor);
  return `${sign}${currency} ${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * Issues the invoice for an order, once, at capture.
 *
 * The whole order is captured at placement, so the invoice covers every item on
 * it — not only the ones that have been delivered. A placement that later fails
 * is credited back with a credit note rather than being left off the invoice,
 * which keeps the invoice matching what was actually charged to the card.
 */
export async function issueInvoiceForOrder(orderId: string) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.invoice.findFirst({ where: { orderId } });
    if (existing) return existing;

    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        reference: true,
        currency: true,
        userId: true,
        items: {
          select: { id: true, status: true, priceCents: true, site: { select: { domain: true } } },
        },
        user: {
          select: {
            email: true,
            name: true,
            legalName: true,
            billingAddress: true,
            taxId: true,
            billingCountry: true,
          },
        },
      },
    });
    if (!order) throw new NotFoundError();

    // Every item on the order, because the whole order was charged. Refunds
    // for failed placements are issued as credit notes against this invoice.
    const billable = order.items;
    if (billable.length === 0) return null;

    const subtotalMinor = billable.reduce((n, i) => n + i.priceCents, 0);
    const year = new Date().getFullYear();
    const number = await nextNumber(tx, "INV", year);

    const buyerLegalName = order.user.legalName || order.user.name || order.user.email;

    const pdf = renderPdf([
      `Invoice ${number}`,
      `Order ${order.reference}`,
      `Issued ${new Date().toISOString().slice(0, 10)}`,
      "",
      `Bill to: ${buyerLegalName}`,
      ...(order.user.billingAddress ? [order.user.billingAddress] : []),
      ...(order.user.taxId ? [`Tax ID: ${order.user.taxId}`] : []),
      "",
      ...billable.map((i) => `${i.site.domain}  ${formatMinor(i.priceCents, order.currency)}`),
      "",
      `Total: ${formatMinor(subtotalMinor, order.currency)}`,
    ]);

    let pdfPath: string | null = null;
    try {
      mkdirSync(INVOICE_DIR, { recursive: true });
      pdfPath = join(INVOICE_DIR, `${number}.pdf`);
      writeFileSync(pdfPath, pdf);
    } catch {
      // A storage failure must not lose the invoice record itself.
      pdfPath = null;
    }

    return tx.invoice.create({
      data: {
        number,
        orderId: order.id,
        userId: order.userId,
        buyerLegalName,
        buyerAddress: order.user.billingAddress,
        buyerTaxId: order.user.taxId,
        buyerCountry: order.user.billingCountry,
        subtotalMinor,
        taxMinor: 0,
        totalMinor: subtotalMinor,
        currency: order.currency,
        pdfPath,
      },
    });
  });
}

/** Corrections are credit notes against the issued invoice, never edits to it. */
export async function issueCreditNote(input: {
  invoiceId: string;
  amountMinor: number;
  reason: string;
}) {
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({
      where: { id: input.invoiceId },
      select: { id: true, currency: true, number: true, buyerLegalName: true },
    });
    if (!invoice) throw new NotFoundError();

    const year = new Date().getFullYear();
    const number = await nextNumber(tx, "CN", year);

    const pdf = renderPdf([
      `Credit note ${number}`,
      `Against invoice ${invoice.number}`,
      `Issued ${new Date().toISOString().slice(0, 10)}`,
      "",
      `For: ${invoice.buyerLegalName}`,
      `Reason: ${input.reason}`,
      "",
      `Amount: ${formatMinor(input.amountMinor, invoice.currency)}`,
    ]);

    let pdfPath: string | null = null;
    try {
      mkdirSync(INVOICE_DIR, { recursive: true });
      pdfPath = join(INVOICE_DIR, `${number}.pdf`);
      writeFileSync(pdfPath, pdf);
    } catch {
      pdfPath = null;
    }

    return tx.creditNote.create({
      data: {
        number,
        invoiceId: invoice.id,
        amountMinor: Math.abs(input.amountMinor),
        currency: invoice.currency,
        reason: input.reason,
        pdfPath,
      },
    });
  });
}

/**
 * Advertiser-facing invoice shape. `pdfPath` is a server path and is not
 * exposed; cost and margin never appear here at all.
 */
const INVOICE_SELECT = {
  id: true,
  number: true,
  orderId: true,
  buyerLegalName: true,
  buyerAddress: true,
  buyerTaxId: true,
  buyerCountry: true,
  subtotalMinor: true,
  taxMinor: true,
  totalMinor: true,
  currency: true,
  issuedAt: true,
  creditNotes: {
    select: { id: true, number: true, amountMinor: true, currency: true, reason: true, issuedAt: true },
  },
} satisfies Prisma.InvoiceSelect;

export async function listInvoices(actor: Actor) {
  return prisma.invoice.findMany({
    where: { userId: actor.id },
    orderBy: { issuedAt: "desc" },
    take: 200,
    select: INVOICE_SELECT,
  });
}

export async function getInvoiceForOrder(actor: Actor, orderId: string) {
  return prisma.invoice.findFirst({
    where: { orderId, userId: actor.id },
    select: INVOICE_SELECT,
  });
}

export async function getInvoicePdfPath(actor: Actor, invoiceId: string): Promise<string> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, userId: actor.id },
    select: { pdfPath: true },
  });
  if (!invoice?.pdfPath) throw new NotFoundError();
  return invoice.pdfPath;
}
