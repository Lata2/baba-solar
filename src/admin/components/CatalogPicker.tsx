import { useMemo, useState } from 'react';
import { PackagePlus, Pencil, Plus, Trash2 } from 'lucide-react';
import type { CatalogItem, LineItem } from '@/types';
import { useCatalog, useCatalogMutations } from '@/queries';
import { useToast } from '@/context/ToastContext';
import { createId } from '@/lib/id';
import { catalogLine } from '@/lib/catalog';
import { formatINR2, GST_RATE_OPTIONS } from '@/lib/totals';
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Modal,
  Select,
  Skeleton,
} from '@/components/ui';
import { IconAction, SearchBox } from './AdminUI';
import { errorMessage } from '../hooks/useCrud';

const CATS = {
  kit: 'Kit',
  bos: 'Balance of system',
  service: 'Service',
} as const;

function useFiltered(q: string) {
  const { data, isPending } = useCatalog();
  const list = useMemo(
    () =>
      (data ?? []).filter((c) =>
        `${c.name} ${c.hsn} ${c.description}`
          .toLowerCase()
          .includes(q.toLowerCase()),
      ),
    [data, q],
  );
  return { list, isPending };
}

/** "Add from catalog" — pick a product (from the supplier sales orders) as an invoice line. */
export function CatalogPicker({
  onPick,
}: {
  onPick: (line: LineItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const { list, isPending } = useFiltered(q);
  const pick = (c: CatalogItem) => {
    onPick(catalogLine(c));
    setOpen(false);
  };
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        leftIcon={<PackagePlus className="size-4" />}
        onClick={() => setOpen(true)}
      >
        Add from catalog
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add a product"
        description="Kits, structure, cables, hardware and services with HSN codes and GST."
        size="lg"
      >
        <SearchBox
          value={q}
          onChange={setQ}
          placeholder="Search product or HSN"
        />
        <div className="mt-3 max-h-[55dvh] overflow-y-auto">
          {isPending ? (
            <Skeleton className="h-40" />
          ) : !list.length ? (
            <EmptyState title="No products match" />
          ) : (
            <ul className="divide-y divide-line rounded-card border border-line">
              {list.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => pick(c)}
                    className="flex w-full items-start justify-between gap-3 px-4 py-2.5 text-left hover:bg-ice-100/60"
                  >
                    <span className="min-w-0">
                      <span className="block font-semibold text-ink">
                        {c.name}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        HSN {c.hsn || '—'} · {c.unit}
                        {c.description ? ` · ${c.description}` : ''}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-sm">
                      <span className="block font-semibold tabular-nums">
                        {formatINR2(c.rate)}
                      </span>
                      <span className="text-xs text-muted">
                        +{c.gstRate}% GST
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>
    </>
  );
}

/** Billing → Products: manage the catalog. */
export function CatalogManager() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const { list, isPending } = useFiltered(q);
  const m = useCatalogMutations();
  const toast = useToast();
  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim())
      return toast({ tone: 'error', title: 'Enter a product name' });
    try {
      await m.save.mutateAsync(editing);
      toast({ title: 'Product saved' });
      setEditing(null);
    } catch (e) {
      toast({
        tone: 'error',
        title: 'Not saved',
        description: errorMessage(e),
      });
    }
  };
  return (
    <>
      <Button
        variant="secondary"
        leftIcon={<PackagePlus className="size-4" />}
        onClick={() => setOpen(true)}
      >
        Products
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Product catalog"
        description="Used by “Add from catalog” on invoices. Rates exclude GST."
        size="lg"
        footer={
          <Button
            leftIcon={<Plus className="size-4" />}
            onClick={() =>
              setEditing({
                id: createId('cat'),
                name: '',
                sku: '',
                description: '',
                hsn: '',
                unit: 'PCS',
                rate: 0,
                gstRate: 18,
                category: 'bos',
              })
            }
          >
            Add product
          </Button>
        }
      >
        <SearchBox
          value={q}
          onChange={setQ}
          placeholder="Search product or HSN"
        />
        <div className="mt-3 max-h-[55dvh] overflow-y-auto">
          {isPending ? (
            <Skeleton className="h-40" />
          ) : (
            <ul className="divide-y divide-line rounded-card border border-line">
              {list.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
                >
                  <span className="min-w-0">
                    <span className="font-semibold">{c.name}</span>{' '}
                    <Badge tone="neutral">{CATS[c.category]}</Badge>
                    <span className="block text-xs text-muted">
                      {c.sku ? `SKU ${c.sku} · ` : ''}HSN {c.hsn || '—'} ·{' '}
                      {formatINR2(c.rate)}/{c.unit} · {c.gstRate}% GST
                    </span>
                  </span>
                  <span className="flex shrink-0">
                    <IconAction
                      label={`Edit ${c.name}`}
                      onClick={() => setEditing({ ...c })}
                    >
                      <Pencil className="size-4" />
                    </IconAction>
                    <IconAction
                      label={`Delete ${c.name}`}
                      danger
                      onClick={() =>
                        void m.remove
                          .mutateAsync(c.id)
                          .then(() => toast({ title: 'Product deleted' }))
                      }
                    >
                      <Trash2 className="size-4" />
                    </IconAction>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.name ? `Edit ${editing.name}` : 'New product'}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={() => void save()} loading={m.save.isPending}>
              Save product
            </Button>
          </>
        }
      >
        {editing && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Name"
              required
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              wrapperClassName="sm:col-span-2"
            />
            <Input
              label="SKU (optional)"
              value={editing.sku ?? ''}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  sku: e.target.value.trimStart().slice(0, 40),
                })
              }
            />
            <Input
              label="Description"
              value={editing.description}
              onChange={(e) =>
                setEditing({ ...editing, description: e.target.value })
              }
              wrapperClassName="sm:col-span-2"
            />
            <Input
              label="HSN/SAC"
              value={editing.hsn}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  hsn: e.target.value.replace(/\D/g, '').slice(0, 10),
                })
              }
            />
            <Input
              label="Unit"
              value={editing.unit}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  unit: e.target.value.toUpperCase().slice(0, 8),
                })
              }
            />
            <Input
              label="Rate (₹, excl. GST)"
              type="number"
              min={0}
              step="any"
              value={editing.rate}
              onChange={(e) =>
                setEditing({ ...editing, rate: Number(e.target.value) })
              }
            />
            <Select
              label="GST"
              value={String(editing.gstRate)}
              onChange={(e) =>
                setEditing({ ...editing, gstRate: Number(e.target.value) })
              }
              options={GST_RATE_OPTIONS}
            />
            <Select
              label="Category"
              value={editing.category}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  category: e.target.value as CatalogItem['category'],
                })
              }
              options={Object.entries(CATS).map(([value, label]) => ({
                value,
                label,
              }))}
            />
          </div>
        )}
      </Modal>
    </>
  );
}
