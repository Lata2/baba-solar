import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import {
  Download,
  Eye,
  FileOutput,
  FolderDown,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Wand2,
} from 'lucide-react';
import type {
  LineItem,
  PropertyType,
  Quality,
  Quotation,
  QuotationStatus,
  QuotationTemplate,
  RoofType,
  SystemType,
} from '@/types';
import {
  useBusiness,
  useCollection,
  useCompanies,
  useConvertToInvoice,
  useQuotationStatus,
  useSaveQuotation,
  useSiteContent,
} from '@/queries';
import { useSeo } from '@/hooks/useSeo';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { api, ApiError, type QuotationSave } from '@/services/api';
import { createId } from '@/lib/id';
import { calculateSolar } from '@/lib/calculator';
import { computeSubsidy } from '@/lib/subsidy';
import { computeTotals, formatINR2 } from '@/lib/totals';
import { QUALITIES, QUALITY_LABEL, packageSizes } from '@/lib/pricing';
import { cn } from '@/lib/cn';
import { GST_STATES, stateCodeOf } from '@/lib/states';
import { downloadCsv } from '@/lib/csv';
import { safeFileName, todayISO, addDaysISO } from '@/lib/files';
import { formatDate, formatINR } from '@/lib/format';
import {
  indianPhone,
  optionalEmail,
  required,
  validate,
} from '@/lib/validation';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Input,
  Modal,
  Segmented,
  Select,
  Textarea,
  Toggle,
} from '@/components/ui';
import {
  AdminPageHeader,
  DataTable,
  FilterSelect,
  IconAction,
  SearchBox,
  Toolbar,
} from '../components/AdminUI';
import { LineItemsEditor, TotalsPanel } from '../components/LineItemsEditor';
import { PdfPreviewModal } from '../components/PdfPreview';
import { useCrud, errorMessage } from '../hooks/useCrud';
import { useSaveDocuments } from '../hooks/useDocuments';

const statusOptions: Array<{ value: QuotationStatus; label: string }> = [
  { value: 'pending', label: 'Pending' },
  { value: 'sent', label: 'Sent' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Rejected' },
];
const SYSTEMS = [
  { value: 'on-grid', label: 'On-grid' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'off-grid', label: 'Off-grid' },
];
const PROPERTIES = [
  { value: 'residential', label: 'Residential' },
  { value: 'commercial', label: 'Commercial / industrial' },
  { value: 'housing-society', label: 'Housing society (RWA/GHS)' },
];
const ROOFS = [
  { value: 'rcc', label: 'RCC flat roof' },
  { value: 'tin', label: 'Tin / metal shed' },
  { value: 'ground', label: 'Ground mounted' },
];
const STATE_NAMES = GST_STATES.map((s) => ({ value: s.name, label: s.name }));

type Form = QuotationSave & {
  id: string;
  isNew: boolean;
  subsidyAuto: boolean;
};

function toForm(q: Quotation | null): Form {
  if (!q) {
    return {
      id: createId('qt'),
      isNew: true,
      subsidyAuto: true,
      status: 'pending',
      quoteDate: todayISO(),
      validUntil: null,
      customerName: '',
      phone: '',
      email: '',
      city: 'Raipur',
      address: '',
      state: 'Chhattisgarh',
      gstin: '',
      consumerNumber: '',
      discom: 'CSPDCL',
      sanctionedLoadKw: null,
      propertyType: 'residential',
      systemType: 'on-grid',
      roofType: 'rcc',
      capacityKw: 3,
      monthlyBill: 2500,
      companyId: null,
      quality: 'normal',
      packagePrice: null,
      items: [],
      discount: 0,
      subsidy: null,
      stateSubsidy: null,
      annualGenerationKwh: null,
      paymentTerms: '',
      terms: '',
      notes: '',
    };
  }
  return {
    id: q.id,
    isNew: false,
    subsidyAuto: q.subsidyAuto ?? false,
    status: q.status,
    quoteDate: q.quoteDate ?? todayISO(),
    validUntil: q.validUntil ?? null,
    customerName: q.customerName,
    phone: q.phone,
    email: q.email,
    city: q.city,
    address: q.address ?? '',
    state: q.state ?? 'Chhattisgarh',
    gstin: q.gstin ?? '',
    consumerNumber: q.consumerNumber ?? '',
    discom: q.discom ?? '',
    sanctionedLoadKw: q.sanctionedLoadKw ?? null,
    propertyType: q.propertyType,
    systemType: q.systemType,
    roofType: q.roofType ?? 'rcc',
    capacityKw: q.capacityKw,
    monthlyBill: q.monthlyBill,
    companyId: q.companyId ?? null,
    quality: q.quality ?? 'normal',
    packagePrice: q.packagePrice ?? null,
    items: q.items ?? [],
    discount: q.discount ?? 0,
    subsidy: q.subsidy,
    stateSubsidy: q.stateSubsidy ?? 0,
    annualGenerationKwh: q.annualGenerationKwh ?? null,
    paymentTerms: q.paymentTerms ?? '',
    terms: q.terms ?? '',
    notes: q.notes,
  };
}

const toPayload = (f: Form): QuotationSave => {
  const { id: _id, isNew: _n, subsidyAuto, ...rest } = f;
  return {
    ...rest,
    subsidy: subsidyAuto ? null : f.subsidy,
    stateSubsidy: subsidyAuto ? null : f.stateSubsidy,
  };
};

export default function QuotationsPage() {
  const quotations = useCollection('quotations');
  useSeo({ title: 'Quotations', path: '/admin/quotations', noIndex: true });
  const crud = useCrud('quotations', 'Quotation');
  const setStatus = useQuotationStatus();
  const convert = useConvertToInvoice();
  const toast = useToast();
  const navigate = useNavigate();
  const { can } = useAuth();
  const canWrite = can('quotations:write');
  const [q, setQ] = useState('');
  const [status, setStatusFilter] = useState<QuotationStatus | 'all'>('all');
  const [editing, setEditing] = useState<Form | null>(null);
  const [pdfFor, setPdfFor] = useState<Quotation | null>(null);
  const docs = useSaveDocuments();

  const rows = useMemo(
    () =>
      quotations
        .filter(
          (x) =>
            (status === 'all' || x.status === status) &&
            `${x.customerName} ${x.phone} ${x.city} ${x.quoteNumber ?? ''}`
              .toLowerCase()
              .includes(q.toLowerCase()),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [quotations, q, status],
  );

  const exportCsv = () =>
    downloadCsv(
      `baba-solars-quotations-${todayISO()}.csv`,
      rows.map((x) => ({
        'Quote no.': x.quoteNumber ?? '',
        Date: formatDate(x.createdAt),
        Customer: x.customerName,
        Phone: x.phone,
        City: x.city,
        Property: x.propertyType,
        System: x.systemType,
        'Size kW': x.capacityKw,
        Company: x.company?.name ?? '',
        Quality: x.quality ?? '',
        'Total incl. GST': x.estimatedCost,
        'Central subsidy': x.subsidy,
        'State subsidy': x.stateSubsidy ?? 0,
        'Net payable after subsidy': x.netCost,
        Status: x.status,
        Source: x.source ?? '',
        Notes: x.notes,
      })),
    );

  const changeStatus = async (x: Quotation, s: QuotationStatus) => {
    try {
      await setStatus.mutateAsync({ id: x.id, status: s });
      toast({ title: `Marked as ${s}` });
    } catch (e) {
      toast({
        tone: 'error',
        title: 'Status not changed',
        description: errorMessage(e),
      });
    }
  };
  const toInvoice = async (x: Quotation) => {
    try {
      const inv = await convert.mutateAsync(x.id);
      toast({
        title: `Invoice ${inv.invoiceNumber} created`,
        description: 'Opening it in Billing.',
      });
      void docs.saveInvoice(inv, true);
      navigate(`/admin/billing?open=${inv.id}`);
    } catch (e) {
      toast({
        tone: 'error',
        title: 'Could not create invoice',
        description: errorMessage(e),
      });
    }
  };

  return (
    <>
      <AdminPageHeader
        title="Quotations"
        description="Requests from the website calculator and quotes you prepare here. Pick a company to fill its saved prices."
        actions={
          <>
            <Button
              variant="secondary"
              leftIcon={<Download className="size-4" />}
              onClick={exportCsv}
              disabled={!rows.length}
            >
              Export CSV
            </Button>
            {canWrite && (
              <Button
                leftIcon={<Plus className="size-4" />}
                onClick={() => setEditing(toForm(null))}
              >
                New quotation
              </Button>
            )}
          </>
        }
      />
      <Toolbar>
        <SearchBox
          value={q}
          onChange={setQ}
          placeholder="Search customer, phone, city or quote no."
        />
        <FilterSelect
          label="Status"
          value={status}
          onChange={setStatusFilter}
          options={[{ value: 'all', label: 'All' }, ...statusOptions]}
        />
      </Toolbar>
      <DataTable
        caption="Quotations"
        rows={rows}
        empty={
          <EmptyState
            title={
              quotations.length ? 'No quotations match' : 'No quotations yet'
            }
            message="Use “Request this quote” on the website calculator, or create one here."
            action={
              canWrite ? (
                <Button onClick={() => setEditing(toForm(null))}>
                  New quotation
                </Button>
              ) : undefined
            }
          />
        }
        columns={[
          {
            header: 'Quote',
            cell: (x) => (
              <div className="whitespace-nowrap">
                <p className="font-semibold text-ink">{x.quoteNumber ?? '—'}</p>
                <p className="text-muted">{formatDate(x.createdAt)}</p>
              </div>
            ),
          },
          {
            header: 'Customer',
            cell: (x) => (
              <div>
                <p className="font-semibold text-ink">{x.customerName}</p>
                <p className="text-muted">
                  {x.phone}
                  {x.city ? `, ${x.city}` : ''}
                </p>
              </div>
            ),
          },
          {
            header: 'System',
            cell: (x) => (
              <div>
                <p>
                  {x.capacityKw} kW {x.systemType}
                </p>
                <p className="text-muted">
                  {x.company ? (
                    `${x.company.name}${x.quality ? ` · ${QUALITY_LABEL[x.quality]}` : ''}`
                  ) : x.source === 'website' ? (
                    <Badge tone="info">Website estimate</Badge>
                  ) : (
                    'No company'
                  )}
                </p>
              </div>
            ),
          },
          {
            header: 'Value',
            cell: (x) => (
              <div className="whitespace-nowrap">
                <p className="font-semibold">{formatINR(x.estimatedCost)}</p>
                {x.subsidy + (x.stateSubsidy ?? 0) > 0 && (
                  <p className="text-muted">
                    {formatINR(x.netCost)} after subsidy
                  </p>
                )}
              </div>
            ),
          },
          {
            header: 'Status',
            cell: (x) => (
              <select
                aria-label={`Status for ${x.customerName}`}
                value={x.status}
                disabled={!canWrite}
                onChange={(e) =>
                  void changeStatus(x, e.target.value as QuotationStatus)
                }
                className="h-8 rounded-field border border-line bg-canvas px-2 text-sm"
              >
                {statusOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ),
          },
          {
            header: 'Actions',
            className: 'text-right',
            cell: (x) => (
              <div className="flex justify-end gap-1">
                <IconAction
                  label={`PDF for ${x.customerName}`}
                  onClick={() => setPdfFor(x)}
                >
                  <Eye className="size-4" />
                </IconAction>
                {canWrite && (
                  <IconAction
                    label={`Save PDF & Excel for ${x.customerName}`}
                    disabled={docs.busy}
                    onClick={() => void docs.saveQuotation(x)}
                  >
                    <FolderDown className="size-4" />
                  </IconAction>
                )}
                {canWrite && (
                  <IconAction
                    label={`Edit quotation for ${x.customerName}`}
                    onClick={() => setEditing(toForm(x))}
                  >
                    <Pencil className="size-4" />
                  </IconAction>
                )}
                {can('invoices:write') && (
                  <IconAction
                    label={`Create invoice from ${x.quoteNumber}`}
                    disabled={!x.items?.length || convert.isPending}
                    onClick={() => void toInvoice(x)}
                  >
                    <FileOutput className="size-4" />
                  </IconAction>
                )}
                {canWrite && (
                  <IconAction
                    label={`Delete quotation for ${x.customerName}`}
                    danger
                    onClick={() => crud.setDeleting(x)}
                  >
                    <Trash2 className="size-4" />
                  </IconAction>
                )}
              </div>
            ),
          },
        ]}
      />

      {editing && (
        <QuoteEditor
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}

      {pdfFor && (
        <QuotationPdfDialog
          quotation={pdfFor}
          onClose={() => setPdfFor(null)}
        />
      )}

      <ConfirmDialog
        open={!!crud.deleting}
        title="Delete this quotation?"
        message={`The quotation for ${crud.deleting?.customerName} will be permanently removed.`}
        confirmLabel="Delete quotation"
        onConfirm={() => void crud.confirmDelete()}
        onCancel={() => crud.setDeleting(null)}
      />
    </>
  );
}

const QUOTE_TEMPLATES: Array<{
  value: QuotationTemplate;
  label: string;
  description: string;
}> = [
  {
    value: 'classic',
    label: 'Classic',
    description: 'Baba Solars navy and gold',
  },
  {
    value: 'modern',
    label: 'Modern',
    description: 'Dark header with clean panels',
  },
  {
    value: 'minimal',
    label: 'Minimal',
    description: 'Monochrome, print-friendly',
  },
];

function QuotationTemplatePicker({
  value,
  onChange,
}: {
  value: QuotationTemplate;
  onChange: (value: QuotationTemplate) => void;
}) {
  return (
    <div
      className="grid grid-cols-1 gap-3 sm:grid-cols-3"
      role="radiogroup"
      aria-label="Select quotation PDF template"
    >
      {QUOTE_TEMPLATES.map((template) => (
        <button
          key={template.value}
          type="button"
          role="radio"
          aria-checked={value === template.value}
          onClick={() => onChange(template.value)}
          className={cn(
            'rounded-card border p-3 text-left transition-colors',
            value === template.value
              ? 'border-navy-700 bg-ice-100 ring-2 ring-sun-400/50'
              : 'border-line bg-surface hover:border-steel-400',
          )}
        >
          <div
            className="aspect-[4/3] overflow-hidden rounded-field border border-line bg-white p-2"
            aria-hidden
          >
            <div
              className={cn(
                'h-1/4 rounded-sm',
                template.value === 'modern'
                  ? 'bg-navy-700'
                  : template.value === 'classic'
                    ? 'bg-navy-700'
                    : 'border-b-2 border-ink',
              )}
            />
            <div className="mt-2 grid grid-cols-2 gap-1">
              <div className="h-5 rounded-sm border border-line" />
              <div className="h-5 rounded-sm border border-line" />
            </div>
            <div
              className={cn(
                'mt-2 h-2',
                template.value === 'modern'
                  ? 'bg-navy-700'
                  : template.value === 'classic'
                    ? 'bg-sun-400'
                    : 'border-b border-ink',
              )}
            />
            {[0, 1, 2].map((row) => (
              <div
                key={row}
                className={cn(
                  'mt-1 h-1.5',
                  template.value === 'modern' && row % 2 === 0
                    ? 'bg-snow-200'
                    : 'border-b border-line',
                )}
              />
            ))}
          </div>
          <span className="mt-2 block text-sm font-semibold text-ink">
            {template.label}
            {value === template.value ? ' · Selected' : ''}
          </span>
          <span className="block text-xs text-muted">
            {template.description}
          </span>
          <span
            className={cn(
              'mt-2 inline-flex rounded-chip px-2.5 py-1 text-xs font-semibold',
              value === template.value
                ? 'bg-navy-700 text-white'
                : 'bg-snow-200 text-ink-soft',
            )}
          >
            {value === template.value ? 'Selected' : 'Select Template'}
          </span>
        </button>
      ))}
    </div>
  );
}

function QuotationPdfDialog({
  quotation,
  onClose,
}: {
  quotation: Quotation;
  onClose: () => void;
}) {
  const [template, setTemplate] = useState<QuotationTemplate>('classic');
  const docs = useSaveDocuments();
  const { can } = useAuth();
  const base = `Quotation-${safeFileName(quotation.quoteNumber ?? 'draft')}-${safeFileName(quotation.customerName)}`;
  return (
    <PdfPreviewModal
      open
      onClose={onClose}
      title={`Quotation ${quotation.quoteNumber ?? ''}`}
      filename={`${base}.pdf`}
      excel={{ filename: `${base}.xlsx`, load: () => api.quotationXlsx(quotation.id) }}
      onSaveFiles={can('quotations:write') ? () => docs.saveQuotation(quotation, template) : undefined}
      load={() => api.quotationPdf(quotation.id, template)}
      reloadKey={`${quotation.id}-${template}-${quotation.updatedAt ?? ''}`}
      toolbar={
        <QuotationTemplatePicker value={template} onChange={setTemplate} />
      }
    />
  );
}

function QuoteEditor({
  initial,
  onClose,
  onSaved,
}: {
  initial: Form;
  onClose: () => void;
  onSaved: () => void;
}) {
  const content = useSiteContent();
  const business = useBusiness().data;
  const companies = useCompanies().data ?? [];
  const save = useSaveQuotation();
  const toast = useToast();
  const docs = useSaveDocuments();
  const [f, setF] = useState<Form>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [filling, setFilling] = useState(false);
  const [preview, setPreview] = useState(false);
  const [template, setTemplate] = useState<QuotationTemplate>('classic');
  const [priced, setPriced] = useState<{
    price: number;
    exact: boolean;
    basis: string;
  } | null>(
    initial.packagePrice
      ? { price: initial.packagePrice, exact: true, basis: 'Package price' }
      : null,
  );
  const lastAuto = useRef<string | null>(
    initial.isNew ? null : JSON.stringify(initial.items),
  );
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((p) => ({ ...p, [k]: v }));
    setErrors((e) => {
      const n = { ...e };
      delete n[k as string];
      return n;
    });
  };

  // New quotations start with the default terms from Settings → Business.
  useEffect(() => {
    if (!initial.isNew || !business) return;
    setF((p) => ({
      ...p,
      paymentTerms: p.paymentTerms || business.quotation.defaultPaymentTerms,
      terms: p.terms || business.quotation.defaultTerms,
      validUntil:
        p.validUntil ??
        addDaysISO(p.quoteDate ?? todayISO(), business.quotation.validityDays),
    }));
  }, [business, initial.isNew]);

  const custCode =
    (f.gstin && /^\d{2}/.test(f.gstin) ? f.gstin.slice(0, 2) : '') ||
    stateCodeOf(f.state ?? '');
  const supplyType: 'intra' | 'inter' =
    !custCode || !business || custCode === business.stateCode
      ? 'intra'
      : 'inter';
  const totals = useMemo(
    () =>
      computeTotals(f.items ?? [], {
        supplyType,
        discountType: 'amount',
        discountValue: f.discount,
        roundOff: true,
      }),
    [f.items, f.discount, supplyType],
  );
  // Same rules as the server-side derivation (src/mocks/logic.ts → src/lib/subsidy.ts).
  const systemCost = (f.items ?? []).length
    ? totals.grandTotal
    : calculateSolar(
        {
          monthlyBill: f.monthlyBill,
          tariff: 0,
          propertyType: f.propertyType,
          systemType: f.systemType,
          roofType: f.roofType ?? 'rcc',
          capacityOverride: f.capacityKw,
        },
        content.calculator,
      ).costMid;
  const rules = computeSubsidy(
    {
      capacityKw: f.capacityKw,
      propertyType: f.propertyType,
      systemType: f.systemType,
      stateCode: custCode || content.calculator.subsidy.defaultStateCode,
      systemCost,
    },
    content.calculator,
  );
  const autoSubsidy = rules.central;
  const subsidy = f.subsidyAuto
    ? rules.central
    : Math.min(f.subsidy ?? 0, Math.round(systemCost));
  const stateSubsidy = f.subsidyAuto
    ? rules.state
    : Math.min(f.stateSubsidy ?? 0, Math.max(0, Math.round(systemCost) - subsidy));

  /** Company + size + quality → package price from the price list, itemised into GST lines. */
  const applyPackage = async (
    next: {
      companyId?: string | null;
      capacityKw?: number;
      quality?: Quality;
    } = {},
    opts: { force?: boolean } = {},
  ) => {
    const companyId =
      next.companyId !== undefined ? next.companyId : f.companyId;
    const capacityKw = next.capacityKw ?? f.capacityKw;
    const quality = next.quality ?? f.quality ?? 'normal';
    if (!companyId || !(capacityKw >= 0.5)) return;
    const untouched =
      !(f.items ?? []).length || lastAuto.current === JSON.stringify(f.items);
    if (!untouched && !opts.force) return;
    setFilling(true);
    try {
      const res = await api.priceQuote(
        companyId,
        capacityKw,
        quality,
        supplyType,
      );
      lastAuto.current = JSON.stringify(res.items);
      setF((p) => ({
        ...p,
        companyId,
        capacityKw,
        quality,
        items: res.items,
        packagePrice: res.price,
        discount: 0,
      }));
      setPriced({ price: res.price, exact: res.exact, basis: res.basis });
      toast({
        title: `${res.company.name} ${QUALITY_LABEL[quality]} · ${capacityKw} kW: ${formatINR(res.price)}`,
        description: `${res.exact ? 'Package price' : res.basis} · ${res.panelCount} × ${res.company.panelWattage} Wp panels.`,
      });
    } catch (e) {
      toast({
        tone: 'error',
        title: 'Could not load company prices',
        description: errorMessage(e),
      });
    } finally {
      setFilling(false);
    }
  };
  const itemsUntouched =
    lastAuto.current !== null && lastAuto.current === JSON.stringify(f.items);
  const company = companies.find((c) => c.id === f.companyId);
  const sizes = packageSizes(companies.filter((c) => c.isActive));

  const validateForm = () => {
    const errs: Record<string, string> = validate(
      { name: f.customerName, phone: f.phone, email: f.email },
      {
        name: [required('the customer name')],
        phone: [indianPhone],
        email: [optionalEmail],
      },
    ) as Record<string, string>;
    if (errs.name) {
      errs.customerName = errs.name;
      delete errs.name;
    }
    if (!(f.capacityKw >= 0.5))
      errs.capacityKw = 'Size must be at least 0.5 kW.';
    (f.items ?? []).forEach((it, i) => {
      if (!it.name.trim()) errs[`items.${i}.name`] = 'Enter an item name.';
      if (!Number.isFinite(it.quantity) || !(it.quantity > 0))
        errs[`items.${i}.quantity`] =
          'Quantity must be a number greater than 0.';
      if (!Number.isFinite(it.rate) || it.rate < 0)
        errs[`items.${i}.rate`] =
          'Rate must be a valid number and cannot be negative.';
    });
    if (!Number.isFinite(f.discount) || f.discount < 0)
      errs.discount = 'Enter a valid discount of 0 or more.';
    else if (
      f.discount > totals.subtotal - totals.itemDiscount &&
      (f.items ?? []).length
    )
      errs.discount = 'Discount is more than the quotation value.';
    if (f.gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(f.gstin))
      errs.gstin = 'Enter a valid 15-character GSTIN.';
    return errs;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs = validateForm();
    setErrors(errs);
    if (Object.keys(errs).length) {
      toast({
        tone: 'error',
        title: 'Fix the highlighted fields',
        description: Object.values(errs)[0],
      });
      return;
    }
    try {
      const saved = await save.mutateAsync({ id: f.id, data: toPayload(f) });
      // Keep the stored PDF + Excel (folder / Google Drive) in step with the saved quotation.
      void docs.saveQuotation(saved, template, true);
      toast({
        title: f.isNew
          ? `Quotation ${saved.quoteNumber} created`
          : 'Quotation saved',
        description: `${formatINR(saved.estimatedCost)} incl. GST`,
      });
      onSaved();
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      toast({
        tone: 'error',
        title: 'Quotation not saved',
        description: errorMessage(err),
      });
    }
  };

  return (
    <>
      <Modal
        open
        onClose={() => !save.isPending && onClose()}
        title={f.isNew ? 'New quotation' : `Edit quotation`}
        size="xl"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={onClose}
              disabled={save.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              leftIcon={<Eye className="size-4" />}
              onClick={() => {
                const errs = validateForm();
                setErrors(errs);
                if (!Object.keys(errs).length) setPreview(true);
              }}
            >
              Preview PDF
            </Button>
            <Button type="submit" form="quote-form" loading={save.isPending}>
              {f.isNew ? 'Create quotation' : 'Save changes'}
            </Button>
          </>
        }
      >
        <form
          id="quote-form"
          onSubmit={submit}
          noValidate
          className="grid gap-6"
        >
          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-ink-soft">
              Select PDF template
            </legend>
            <QuotationTemplatePicker value={template} onChange={setTemplate} />
          </fieldset>
          <section
            className="grid gap-4 rounded-card border border-sun-500/40 bg-sun-300/15 p-4"
            aria-label="Package"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-sans text-base font-semibold">
                Company, size & quality
              </h3>
              {priced && (
                <p className="text-sm">
                  <span className="text-muted">
                    {priced.exact ? 'Package price' : priced.basis}:
                  </span>{' '}
                  <strong className="tabular-nums">
                    {formatINR(priced.price)}
                  </strong>{' '}
                  <span className="text-muted">
                    {company?.pricesIncludeGst === false
                      ? '+ GST'
                      : 'incl. GST'}
                  </span>
                </p>
              )}
            </div>
            <div className="grid gap-4 md:grid-cols-[1fr_1fr_1fr]">
              <Select
                label="Company"
                value={f.companyId ?? ''}
                placeholder="— Choose a company —"
                options={companies
                  .filter((c) => c.isActive || c.id === f.companyId)
                  .map((c) => ({ value: c.id, label: c.name }))}
                onChange={(e) => {
                  const id = e.target.value || null;
                  set('companyId', id);
                  if (id) void applyPackage({ companyId: id }, { force: true });
                }}
                hint={
                  companies.length
                    ? 'Prices come from Companies & rates.'
                    : 'Add companies under Companies & rates.'
                }
              />
              <div className="grid gap-1.5">
                <Input
                  label="System size (kW)"
                  required
                  type="number"
                  step="0.5"
                  min={0.5}
                  value={f.capacityKw}
                  error={errors.capacityKw}
                  onChange={(e) => set('capacityKw', Number(e.target.value))}
                  onBlur={() => void applyPackage()}
                />
                <div
                  className="flex flex-wrap gap-1"
                  role="group"
                  aria-label="Package sizes"
                >
                  {sizes.map((kw) => (
                    <button
                      key={kw}
                      type="button"
                      onClick={() =>
                        void applyPackage(
                          { capacityKw: kw },
                          { force: !!f.companyId },
                        )
                      }
                      className={cn(
                        'rounded-chip border px-2.5 py-0.5 text-xs font-semibold',
                        f.capacityKw === kw
                          ? 'border-navy-700 bg-navy-700 text-snow-50'
                          : 'border-line bg-surface text-ink-soft hover:border-steel-400',
                      )}
                      aria-pressed={f.capacityKw === kw}
                      onMouseDown={() => set('capacityKw', kw)}
                    >
                      {kw} kW
                    </button>
                  ))}
                </div>
              </div>
              <Segmented<Quality>
                label="Quality"
                value={f.quality ?? 'normal'}
                onChange={(q) => {
                  set('quality', q);
                  void applyPackage({ quality: q }, { force: true });
                }}
                options={QUALITIES.map((q) => ({
                  value: q,
                  label: QUALITY_LABEL[q],
                }))}
              />
            </div>
            {company && (
              <p className="text-sm text-muted">
                {QUALITY_LABEL[f.quality ?? 'normal']}:{' '}
                {company.qualities[f.quality ?? 'normal'].panelWattage} Wp{' '}
                {company.qualities[f.quality ?? 'normal'].panelTechnology},{' '}
                {company.qualities[f.quality ?? 'normal'].inverterBrand}{' '}
                inverter,{' '}
                {
                  company.qualities[f.quality ?? 'normal']
                    .performanceWarrantyYears
                }
                -year performance warranty.
              </p>
            )}
          </section>

          <section
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            aria-label="Customer"
          >
            <h3 className="font-sans text-base font-semibold sm:col-span-2 lg:col-span-3">
              Customer & site
            </h3>
            <Input
              label="Customer name"
              required
              value={f.customerName}
              onChange={(e) => set('customerName', e.target.value)}
              error={errors.customerName}
            />
            <Input
              label="Mobile"
              required
              type="tel"
              value={f.phone}
              onChange={(e) => set('phone', e.target.value)}
              error={errors.phone}
            />
            <Input
              label="Email"
              type="email"
              value={f.email}
              onChange={(e) => set('email', e.target.value)}
              error={errors.email}
            />
            <Input
              label="Address"
              value={f.address ?? ''}
              onChange={(e) => set('address', e.target.value)}
              wrapperClassName="sm:col-span-2"
            />
            <Input
              label="City"
              value={f.city}
              onChange={(e) => set('city', e.target.value)}
            />
            <Select
              label="State"
              value={f.state ?? 'Chhattisgarh'}
              onChange={(e) => set('state', e.target.value)}
              options={STATE_NAMES}
            />
            <Input
              label="GSTIN (for businesses)"
              value={f.gstin ?? ''}
              onChange={(e) => set('gstin', e.target.value.toUpperCase())}
              error={errors.gstin}
              maxLength={15}
            />
            <Input
              label="Electricity consumer no."
              value={f.consumerNumber ?? ''}
              onChange={(e) => set('consumerNumber', e.target.value)}
            />
            <Input
              label="DISCOM"
              value={f.discom ?? ''}
              onChange={(e) => set('discom', e.target.value)}
            />
            <Input
              label="Sanctioned load (kW)"
              type="number"
              min={0}
              step="0.5"
              value={f.sanctionedLoadKw ?? ''}
              onChange={(e) =>
                set(
                  'sanctionedLoadKw',
                  e.target.value === '' ? null : Number(e.target.value),
                )
              }
            />
          </section>

          <section
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            aria-label="System"
          >
            <h3 className="font-sans text-base font-semibold sm:col-span-2 lg:col-span-3">
              System
            </h3>
            <Select
              label="Property"
              value={f.propertyType}
              onChange={(e) =>
                set('propertyType', e.target.value as PropertyType)
              }
              options={PROPERTIES}
            />
            <Select
              label="System type"
              value={f.systemType}
              onChange={(e) => set('systemType', e.target.value as SystemType)}
              options={SYSTEMS}
            />
            <Select
              label="Installation"
              value={f.roofType ?? 'rcc'}
              onChange={(e) => set('roofType', e.target.value as RoofType)}
              options={ROOFS}
            />
            <Input
              label="Monthly bill"
              prefix="₹"
              type="number"
              min={0}
              value={f.monthlyBill}
              onChange={(e) => set('monthlyBill', Number(e.target.value))}
            />
          </section>

          <section className="grid gap-3" aria-label="Price lines">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-sans text-base font-semibold">
                Bill of materials & price
              </h3>
              {f.companyId && (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={filling}
                  leftIcon={
                    itemsUntouched ? (
                      <RefreshCw className="size-4" />
                    ) : (
                      <Wand2 className="size-4" />
                    )
                  }
                  onClick={() => void applyPackage({}, { force: true })}
                >
                  {itemsUntouched
                    ? 'Refresh package price'
                    : `Re-apply ${QUALITY_LABEL[f.quality ?? 'normal']} ${f.capacityKw} kW price`}
                </Button>
              )}
            </div>
            {!itemsUntouched && f.companyId && lastAuto.current !== null && (
              <p className="text-sm text-muted">
                Lines were edited by hand, so they are not replaced
                automatically. Use the button to re-apply the package price.
              </p>
            )}
            <LineItemsEditor
              items={f.items ?? []}
              onChange={(items: LineItem[]) => set('items', items)}
              totals={totals}
              errors={errors}
            />
            {!(f.items ?? []).length && (
              <p className="text-sm text-muted">
                Without lines the PDF shows the calculator estimate for{' '}
                {f.capacityKw} kW.
              </p>
            )}
          </section>

          <section className="grid gap-4 lg:grid-cols-[1fr_22rem]">
            <div className="grid content-start gap-4 sm:grid-cols-2">
              <Input
                label="Discount (₹, before GST)"
                prefix="₹"
                type="number"
                min={0}
                value={f.discount}
                onChange={(e) => set('discount', Number(e.target.value))}
                error={errors.discount}
              />
              <Select
                label="Status"
                value={f.status}
                onChange={(e) =>
                  set('status', e.target.value as QuotationStatus)
                }
                options={statusOptions}
              />
              <div className="rounded-card border border-leaf-500/30 bg-leaf-100/60 p-4 sm:col-span-2">
                <Toggle
                  label="Calculate subsidy automatically (central + state)"
                  checked={f.subsidyAuto}
                  onChange={(v) =>
                    setF((p) => ({
                      ...p,
                      subsidyAuto: v,
                      subsidy: v ? null : autoSubsidy,
                      stateSubsidy: v ? null : stateSubsidy,
                    }))
                  }
                  description={
                    rules.notes[0] ??
                    `PM Surya Ghar central subsidy${rules.stateScheme ? ` + ${rules.stateScheme}` : ''} for ${rules.stateName || 'the customer state'}. Rules: Settings → Calculator → Subsidy.`
                  }
                />
                <dl className="mt-3 grid gap-1 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Total system cost</dt>
                    <dd className="font-semibold tabular-nums">
                      {formatINR(systemCost)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Central subsidy (PM Surya Ghar)</dt>
                    <dd className="whitespace-nowrap font-semibold tabular-nums text-leaf-700">
                      – {formatINR(subsidy)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">
                      State subsidy{rules.stateScheme ? ` (${rules.stateScheme})` : ''}
                    </dt>
                    <dd className="whitespace-nowrap font-semibold tabular-nums text-leaf-700">
                      – {formatINR(stateSubsidy)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3 border-t border-leaf-500/30 pt-1">
                    <dt className="font-semibold text-ink">Net payable after subsidy</dt>
                    <dd className="font-semibold tabular-nums">
                      {formatINR(Math.max(0, systemCost - subsidy - stateSubsidy))}
                    </dd>
                  </div>
                </dl>
                {!f.subsidyAuto && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Input
                      label="Central subsidy (CFA)"
                      prefix="₹"
                      type="number"
                      min={0}
                      value={f.subsidy ?? 0}
                      onChange={(e) => set('subsidy', Number(e.target.value))}
                    />
                    <Input
                      label="State subsidy"
                      prefix="₹"
                      type="number"
                      min={0}
                      value={f.stateSubsidy ?? 0}
                      onChange={(e) =>
                        set('stateSubsidy', Number(e.target.value))
                      }
                    />
                  </div>
                )}
              </div>
            </div>
            <TotalsPanel
              totals={totals}
              supplyType={supplyType}
              extra={
                (f.items ?? []).length
                  ? [
                      ...(subsidy > 0
                        ? [
                            {
                              label: 'Central subsidy (PM Surya Ghar)',
                              value: -subsidy,
                              tone: 'good' as const,
                            },
                          ]
                        : []),
                      ...(stateSubsidy > 0
                        ? [
                            {
                              label: 'State subsidy',
                              value: -stateSubsidy,
                              tone: 'good' as const,
                            },
                          ]
                        : []),
                      ...(subsidy + stateSubsidy > 0
                        ? [
                            {
                              label: 'Net payable after subsidy',
                              value: Math.max(
                                0,
                                totals.grandTotal - subsidy - stateSubsidy,
                              ),
                              strong: true,
                            },
                          ]
                        : []),
                    ]
                  : []
              }
            />
          </section>

          <section className="grid gap-4 sm:grid-cols-2" aria-label="Terms">
            <h3 className="font-sans text-base font-semibold sm:col-span-2">
              Validity & terms
            </h3>
            <Input
              label="Quotation date"
              type="date"
              value={f.quoteDate ?? ''}
              onChange={(e) => set('quoteDate', e.target.value)}
            />
            <Input
              label="Valid until"
              type="date"
              value={f.validUntil ?? ''}
              onChange={(e) => set('validUntil', e.target.value || null)}
            />
            <Textarea
              label="Payment terms"
              rows={3}
              value={f.paymentTerms ?? ''}
              onChange={(e) => set('paymentTerms', e.target.value)}
              hint="One per line."
            />
            <Textarea
              label="Terms & conditions"
              rows={3}
              value={f.terms ?? ''}
              onChange={(e) => set('terms', e.target.value)}
              hint="One per line. Defaults come from Settings → Business."
            />
            <Textarea
              label="Internal notes (not printed)"
              rows={2}
              value={f.notes}
              onChange={(e) => set('notes', e.target.value)}
              wrapperClassName="sm:col-span-2"
            />
          </section>
          {!f.isNew && (
            <p className="text-xs text-muted">
              Totals: {formatINR2(totals.grandTotal)} incl. GST · subsidy &
              numbers are confirmed by the server on save.
            </p>
          )}
        </form>
      </Modal>

      <PdfPreviewModal
        open={preview}
        onClose={() => setPreview(false)}
        title="Quotation preview (not saved yet)"
        filename={`Quotation-${safeFileName(f.customerName || 'draft')}.pdf`}
        load={() =>
          api.quotationPreviewPdf(
            toPayload(f),
            f.isNew ? undefined : f.id,
            template,
          )
        }
        reloadKey={template}
        toolbar={
          <QuotationTemplatePicker value={template} onChange={setTemplate} />
        }
      />
    </>
  );
}
