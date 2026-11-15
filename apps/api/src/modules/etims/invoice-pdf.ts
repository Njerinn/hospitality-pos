// Phase 018a: KRA-style fiscal invoice PDF (Original + Copy).
// Consumes already-computed ticket totals + fiscal receipt metadata.
// Pure render — no DB access. Caller loads data and passes it in.
import PDFDocument from 'pdfkit';

export interface InvoicePdfData {
  tenant: {
    name: string;
    kra_pin: string | null;
    business_structure: string | null;
    vat_registered: boolean;
    vat_inclusive: boolean;
    paybill_number: string | null;
    etims_enabled: boolean;
    etims_mode: 'disabled' | 'sandbox' | 'production';
  };
  ticket: {
    id: string;
    type: 'dine_in' | 'retail';
    opened_at: Date;
    closed_at: Date | null;
    subtotal: number;
    vat_amount: number;
    total: number;
  };
  items: Array<{
    name: string;
    quantity: number;
    unit_price: number;
    line_total: number;
    tax_ty_cd: 'A' | 'B' | 'C' | 'D' | 'E';
  }>;
  fiscal: {
    invc_no: number;
    rcpt_no: number;
    intrl_data: string;
    rcpt_sign: string;
    submitted_at: Date;
  };
  qr_png: Buffer;
  seller_email: string | null;
}

const TAX_LABELS: Record<string, string> = {
  A: 'Exempt',
  B: 'VAT 16%',
  C: 'Zero',
  D: 'Non-VAT',
  E: 'VAT 8%',
};

function fmtKES(n: number): string {
  return n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

function fmtNairobi(d: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).format(d) + ' EAT';
}

export async function renderInvoicePdf(data: InvoicePdfData, mode: 'original' | 'copy'): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const fiscalMode = data.tenant.etims_enabled && data.tenant.etims_mode === 'production';

  // ── Header banner (mode indicator) ──
  if (!fiscalMode) {
    doc.rect(50, 40, 495, 22).fill('#fef3c7');
    doc.fillColor('#92400e').fontSize(10).font('Helvetica-Bold')
      .text('NON-FISCAL / TRAINING MODE — Not a valid KRA fiscal receipt', 50, 46, { width: 495, align: 'center' });
    doc.moveDown(1.2);
  }

  // ── Tenant block ──
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(18)
    .text(data.tenant.name, { align: 'center' });
  doc.moveDown(0.2);
  doc.font('Helvetica').fontSize(10).fillColor('#475569');
  if (data.tenant.kra_pin) {
    doc.text(`KRA PIN: ${data.tenant.kra_pin}`, { align: 'center' });
  }
  if (data.tenant.business_structure) {
    const label = data.tenant.business_structure.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    doc.text(`Business Structure: ${label}`, { align: 'center' });
  }
  if (data.tenant.paybill_number) {
    doc.text(`M-Pesa Paybill: ${data.tenant.paybill_number}`, { align: 'center' });
  }
  doc.moveDown(0.8);

  // ── Invoice title + mode ──
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#0f172a')
    .text('TAX INVOICE', { align: 'center' });
  doc.font('Helvetica-Bold').fontSize(14).fillColor(mode === 'original' ? '#059669' : '#2563eb')
    .text(mode.toUpperCase(), { align: 'center' });
  doc.moveDown(0.8);

  // ── Invoice meta ──
  doc.font('Helvetica').fontSize(10).fillColor('#334155');
  doc.text(`Invoice No:    CU-INV-${pad(data.fiscal.invc_no, 6)}`);
  doc.text(`Receipt No:    ${pad(data.fiscal.rcpt_no, 6)}`);
  doc.text(`Date:          ${fmtNairobi(data.fiscal.submitted_at)}`);
  if (data.seller_email) {
    doc.text(`Cashier:       ${data.seller_email}`);
  }
  doc.text(`Type:          ${data.ticket.type === 'retail' ? 'Retail Sale' : 'Dine-In'}`);
  doc.moveDown(0.8);

  // ── Items table header ──
  const tableTop = doc.y;
  const colX = { name: 50, qty: 320, price: 365, total: 445, tax: 510 };
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a');
  doc.text('Item', colX.name, tableTop, { width: 260 });
  doc.text('Qty', colX.qty, tableTop, { width: 40 });
  doc.text('Price', colX.price, tableTop, { width: 70, align: 'right' });
  doc.text('Total', colX.total, tableTop, { width: 55, align: 'right' });
  doc.text('Tax', colX.tax, tableTop, { width: 30, align: 'right' });
  doc.moveTo(50, doc.y + 3).lineTo(545, doc.y + 3).stroke('#cbd5e1');
  doc.moveDown(0.3);

  // ── Items rows ──
  doc.font('Helvetica').fontSize(9).fillColor('#1e293b');
  for (const item of data.items) {
    const y = doc.y;
    doc.text(item.name, colX.name, y, { width: 260, ellipsis: true });
    doc.text(String(item.quantity), colX.qty, y, { width: 40 });
    doc.text(fmtKES(item.unit_price), colX.price, y, { width: 70, align: 'right' });
    doc.text(fmtKES(item.line_total), colX.total, y, { width: 55, align: 'right' });
    doc.text(item.tax_ty_cd, colX.tax, y, { width: 30, align: 'right' });
    doc.moveDown(0.15);
  }
  doc.moveTo(50, doc.y + 3).lineTo(545, doc.y + 3).stroke('#cbd5e1');
  doc.moveDown(0.5);

  // ── Totals ──
  doc.font('Helvetica').fontSize(10).fillColor('#1e293b');
  doc.text(`Subtotal (VAT excl):`, 380, doc.y, { width: 100, align: 'right' });
  doc.text(`KES ${fmtKES(data.ticket.subtotal)}`, 480, doc.y - 12, { width: 65, align: 'right' });
  doc.text(`VAT:`, 380, doc.y, { width: 100, align: 'right' });
  doc.text(`KES ${fmtKES(data.ticket.vat_amount)}`, 480, doc.y - 12, { width: 65, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(12);
  doc.text(`Total:`, 380, doc.y + 2, { width: 100, align: 'right' });
  doc.text(`KES ${fmtKES(data.ticket.total)}`, 480, doc.y - 14, { width: 65, align: 'right' });
  doc.moveDown(1.5);

  // ── QR + fiscal signature block ──
  const qrSize = 110;
  const qrY = doc.y;
  doc.image(data.qr_png, 50, qrY, { width: qrSize });

  doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a')
    .text('Fiscal Signature', 180, qrY, { width: 365 });
  doc.font('Helvetica').fontSize(7).fillColor('#334155')
    .text(data.fiscal.rcpt_sign, 180, qrY + 12, { width: 365, height: 40 });
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a')
    .text('Internal Data', 180, doc.y + 4, { width: 365 });
  doc.font('Helvetica').fontSize(7).fillColor('#334155')
    .text(data.fiscal.intrl_data, 180, doc.y + 2, { width: 365, height: 40 });

  doc.y = Math.max(doc.y + 60, qrY + qrSize + 10);
  doc.moveDown(0.8);

  // ── Footer ──
  doc.font('Helvetica').fontSize(8).fillColor('#64748b')
    .text(
      `This ${mode} was generated on ${fmtNairobi(new Date())} for ${data.tenant.name}. ` +
      (fiscalMode
        ? 'Fiscally signed via KRA eTIMS.'
        : 'Training/sandbox mode — not a legally valid KRA fiscal receipt.'),
      { align: 'center', width: 495 }
    );

  doc.end();
  return finished;
}
