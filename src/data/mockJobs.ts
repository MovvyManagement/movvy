import type { MoverJob } from '@/types';

// Mock job feed used by the driver Jobs screen when there's no live data.
// Aligned to the only two move types Movvy currently offers: Residential + Commercial.

export const mockJobs: MoverJob[] = [
  {
    id: 'j_881',
    customer: { name: 'Jordan W.', rating: 4.9 },
    pickup: { label: '', line1: '1212 17 Ave SW', city: 'Calgary', province: 'AB', postal: 'T2T 0B8' },
    dropoff: { label: '', line1: '434 Inglewood Dr SE', city: 'Calgary', province: 'AB', postal: 'T2G 1B4' },
    moveType: 'home_move',
    scheduledFor: '2026-05-20T17:30:00Z',
    payout: 322,
    distanceKm: 11.4,
    durationMin: 26,
    itemsSummary: '2-bed apartment · 4th floor, elevator · ~38 items',
    status: 'searching',
  },
  {
    id: 'j_882',
    customer: { name: 'Hana P.', rating: 4.7 },
    pickup: { label: '', line1: '120 7 St NE', city: 'Calgary', province: 'AB', postal: 'T2E 4B9' },
    dropoff: { label: '', line1: '88 Mahogany Ter SE', city: 'Calgary', province: 'AB', postal: 'T3M 2K9' },
    moveType: 'home_move',
    scheduledFor: '2026-05-21T09:30:00Z',
    payout: 540,
    distanceKm: 16.2,
    durationMin: 31,
    itemsSummary: '3-bed house · garage · main floor',
    status: 'searching',
  },
  {
    id: 'j_877',
    customer: { name: 'Northstar Tech', rating: 4.8 },
    pickup: { label: '', line1: '215 9 Ave SW', city: 'Calgary', province: 'AB', postal: 'T2P 1K3' },
    dropoff: { label: '', line1: '1100 8 Ave SW', city: 'Calgary', province: 'AB', postal: 'T2P 3T9' },
    moveType: 'commercial',
    scheduledFor: '2026-05-21T13:00:00Z',
    payout: 980,
    distanceKm: 2.4,
    durationMin: 8,
    itemsSummary: 'Office · 4 crew · 4 hours · 22 desks',
    status: 'searching',
  },
];
