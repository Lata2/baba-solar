import type { LineItem } from '@/types'

/**
 * The two supplier sales orders shared by the client (Shakti Solar Solutions, TallyPrime,
 * 22-Oct-26), transcribed line by line. Used as demo documents (Tally-style template) and as
 * unit-test fixtures: our GST engine reproduces their CGST/SGST, round-off and totals exactly.
 *   SO 3844 (3 kW kit): taxable 2,33,384.00 · CGST 7,346.76 · SGST 7,346.76 · round off 0.48 · total 2,48,078.00
 *   SO 3861 (5 kW kit): taxable 3,88,316.00 · CGST 11,223.44 · SGST 11,223.44 · round off 0.12 · total 4,10,763.00
 * GST: kits and MC4 connectors 5 %, everything else 18 % (the only split that reproduces both totals).
 */
let n = 0
const line = (name: string, hsn: string, quantity: number, unit: string, rate: number, gstRate = 18, description = ''): LineItem =>
  ({ id: `so-${++n}`, name, description, hsn, unit, quantity, rate, discountPct: 0, gstRate })

const WAAREE_KIT = (watt: number) => `${watt} Wp × 6 · ACDB/DCDB × 1 · pit cover × 3 · LA × 1 · MC4 connector × 4 · earthing rod × 3 · 15 kg chemical bag · Waaree inverter × 1`

export const SO_3844: LineItem[] = [
  line('Base plate 80×40', '73089090', 4, 'PCS', 90),
  line('Havells 4 sq mm × 2C AC cable', '85444999', 35, 'MTR', 126),
  line('Havells 4 sq mm DC solar cable', '85446090', 35, 'MTR', 62),
  line('Elbow 25 mm', '73079290', 40, 'PCS', 7),
  line('Tee 25 mm', '39174000', 5, 'PCS', 7),
  line('Kaju khila 25 mm', '39259090', 1, 'PAC', 110),
  line('Paruma cable tie 300 mm', '392390', 1, 'PAC', 90),
  line('Cable tray 45×45', '85389000', 1, 'PCS', 90),
  line('Rigid LMS pipe 25 mm', '39172390', 20, 'PCS', 55),
  line('Electrical tape', '73089090', 1, 'PCS', 8),
  line('PVC meter board small', '85371000', 1, 'PCS', 160),
  line('MCB box 2-way', '85371000', 1, 'PCS', 50),
  line('MCB DP 6–32 A V-Guard', '85362030', 1, 'PCS', 450),
  line('Screw with rawal grip', '73181900', 5, 'PCS', 5),
  line('Earthing nut 30 mm with lug', '85369090', 4, 'PCS', 16),
  line('J hook with nut 40×40', '731829', 24, 'NOS', 15),
  line('MC4 connector', '', 4, 'NOS', 30, 5),
  line('SS bolt 10×50', '73181500', 20, 'PCS', 18),
  line('GI mid clamp set', '73089090', 10, 'SET', 35),
  line('GI end clamp set', '73089090', 10, 'SET', 34),
  line('Wedge anchor 12×100', '73181900', 16, 'PCS', 15),
  line('Solar structure channel', '73061919', 67, 'KG', 86, 18, '3 ft 80×40 = 2 legs · 5 ft 80×40 = 2 legs · 14 ft 80×40 = 2 nos · 12 ft 41×41 = 4 nos'),
  line('3 kW Waaree Bifacial Kit', '', 1, 'SET', 98000, 5, WAAREE_KIT(540)),
  line('Havells 4 sq mm earthing wire', '', 100, 'MTR', 62),
  line('Flexible pipe 25 mm', '39172390', 1, 'BDL', 250),
  line('3 kW Waaree TOPCon Kit', '', 1, 'SET', 112000, 5, WAAREE_KIT(580)),
]

export const SO_3861: LineItem[] = [
  line('Solar structure channel', '73061919', 106, 'KG', 89, 18, '3 ft 80×40 = 3 legs · 5 ft 80×40 = 3 legs · 14 ft 80×40 = 3 legs · 20 ft 41×41 = 4 nos'),
  line('SS bolt 10×50', '73181500', 30, 'PCS', 18),
  line('Wedge anchor 12×100', '73181500', 24, 'PCS', 15),
  line('GI mid clamp set', '73089090', 12, 'SET', 35),
  line('GI end clamp set', '73089090', 10, 'SET', 34),
  line('Base plate 80×40', '73089090', 6, 'PCS', 90),
  line('Lightning arrester 14 mm × 1 m', '85354010', 1, 'PCS', 340, 18, 'Base & insulator'),
  line('Earthing rod 14 mm × 1 m', '74071020', 3, 'PCS', 210, 18, '15 kg chemical bag'),
  line('Pit cover', '39021000', 3, 'PCS', 90),
  line('Polycab AC wire 4 sq mm 2C', '85446090', 35, 'MTR', 126),
  line('Polycab DC cable 4 sq mm', '85446090', 35, 'MTR', 62),
  line('Al earthing wire 16 sq mm', '85446090', 100, 'MTR', 19),
  line('Elbow 25 mm', '73079290', 40, 'PCS', 7),
  line('Tee 25 mm', '39174000', 5, 'PCS', 7),
  line('Kaju khila 25 mm', '39259090', 1, 'PAC', 110),
  line('Cable tie 300 mm', '39231040', 1, 'PAC', 90),
  line('Cable tray', '39172310', 1, 'PCS', 90),
  line('Rigid LMS pipe 25 mm', '39172390', 20, 'PCS', 55),
  line('Electrical tape', '73089090', 1, 'PCS', 8),
  line('PVC meter board small', '85371000', 1, 'PCS', 160),
  line('Earthing nut 30 mm with lug', '85369090', 4, 'PCS', 16),
  line('Screw with rawal grip', '73181900', 5, 'PCS', 5),
  line('5 kW Waaree Bifacial Kit', '', 1, 'SET', 179000, 5, WAAREE_KIT(540)),
  line('5 kW Waaree TOPCon Kit', '', 1, 'SET', 186000, 5, WAAREE_KIT(580)),
]
