import type { CatalogItem, LineItem } from '@/types';
import { createId } from './id';

/** Snapshot current catalog values into an editable invoice line. */
export function catalogLine(item: CatalogItem): LineItem {
  return {
    id: createId('ln'),
    name: item.name,
    sku: item.sku ?? '',
    description: item.description,
    hsn: item.hsn,
    unit: item.unit,
    quantity: 1,
    rate: item.rate,
    discountPct: 0,
    gstRate: item.gstRate,
  };
}
