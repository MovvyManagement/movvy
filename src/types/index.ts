export type UserRole = 'customer' | 'driver' | 'company' | 'admin';

// Mutually-exclusive top-level categories. "Same-day" lives on the schedule step (ASAP toggle), not here.
export type MoveType =
  | 'home_move'      // residential point-A-to-B (apartment, condo, house)
  | 'commercial'     // office, retail, warehouse — hourly billed
  | 'single_items'   // 1+ specific items (couch, fridge, IKEA pickup, store delivery)
  | 'labor_only';    // no truck — just helpers for loading, junk run, in-home moving

export type HomeDwelling = 'apartment' | 'condo' | 'house' | 'townhouse';
export type CommercialKind = 'office' | 'retail' | 'warehouse' | 'restaurant';

export type LaborTask = 'loading' | 'unloading' | 'in_home' | 'junk_run' | 'packing' | 'other';

export interface ItemSpec {
  id: string;
  label: string;
  count: number;
  heavy?: boolean;
}

export type BookingStatus =
  | 'pending'
  | 'searching'
  | 'assigned'
  | 'confirmed'
  | 'on_the_way'
  | 'arrived'
  | 'loading'
  | 'in_transit'
  | 'unloading'
  | 'completed'
  | 'cancelled';

export interface Address {
  label: string;
  line1: string;
  city: string;
  province: string;
  postal: string;
  lat?: number;
  lng?: number;
}

export interface MoveDetails {
  // home_move
  dwelling?: HomeDwelling;
  bedrooms?: number;
  livingRooms?: number;
  bathrooms?: number;
  floor?: number;
  hasElevator?: boolean;

  // commercial
  commercialKind?: CommercialKind;
  sqft?: number;
  workstations?: number;

  // single_items
  items?: ItemSpec[];
  stairsPickup?: number;
  stairsDropoff?: number;

  // labor_only
  helpers?: number;
  laborTasks?: LaborTask[];

  // shared (commercial + labor_only use these)
  crewSize?: number;
  estimatedHours?: number;

  // shared add-ons
  fragileItems?: boolean;
  heavyItems?: boolean;
  packingNeeded?: boolean;
  assemblyNeeded?: boolean;

  notes?: string;
  photoUris?: string[];

  /** Access details — what the crew needs to know BEFORE they pull up, so they
   *  aren't circling the block or stuck at a locked lobby door. Optional; the
   *  fast preset booking path skips it and the crew screen just hides what
   *  wasn't provided. */
  access?: MoveAccess;
}

export interface MoveAccess {
  /** Floor the stuff is on at each end (0/undefined = ground). */
  pickupFloor?: number;
  dropoffFloor?: number;
  /** Is there a usable elevator at that end? */
  pickupElevator?: boolean;
  dropoffElevator?: boolean;
  /** "Loading dock out back", "alley only, no street parking", … */
  parking?: string;
  /** Buzzer / gate / lockbox code so the crew isn't calling from the curb. */
  entryCode?: string;
  /** Anything else the crew should know on arrival. */
  notes?: string;
}

export interface BookingDraft {
  moveType?: MoveType;
  pickup?: Address;
  dropoff?: Address;
  details?: MoveDetails;
  date?: string;
  timeWindow?: string;
  scheduling?: 'asap' | 'scheduled';
  promoCode?: string;
}

export interface Booking {
  id: string;
  status: BookingStatus;
  moveType: MoveType;
  pickup: Address;
  dropoff: Address;
  details: MoveDetails;
  date: string;
  timeWindow: string;
  price: number;
  serviceFee: number;
  tax: number;
  total: number;
  mover?: Mover;
  createdAt: string;
}

export interface Mover {
  id: string;
  name: string;
  rating: number;
  trips: number;
  vehicle: string;
  photo?: string;
  phone: string;
  company?: string;
}

export interface MoverJob {
  id: string;
  customer: { name: string; rating: number; photo?: string };
  pickup: Address;
  dropoff: Address;
  moveType: MoveType;
  scheduledFor: string;
  payout: number;
  distanceKm: number;
  durationMin: number;
  itemsSummary: string;
  status: BookingStatus;
}

export interface ChatMessage {
  id: string;
  from: 'me' | 'them' | 'admin';
  body: string;
  at: string;
}
