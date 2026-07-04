import { create } from 'zustand';

export interface TeamMember {
  fullName: string;
  email: string;
  phone: string;
  licenseNumber?: string; // required for driver
}

export interface CompanyDraft {
  companyName: string;
  registration: string;
  /** Company contact phone (digits-only, no country code). */
  phone: string;
  /** Company contact email — required (the company's main inbox). */
  email: string;
  city: string;
  hqAddress: string;
  hqLat?: number;
  hqLng?: number;
  driverCount: number;
  truckCount: number;
  drivers: CompanyDriver[];
}

export interface CompanyDriver {
  id: string;            // local generated id
  fullName: string;
  licenseNumber: string;
  phone: string;
  email: string;
  vehicleAssigned?: string;
}

interface PartnerState {
  // Solo / 2-person team partner state
  teamDriver: TeamMember;
  teamMover: TeamMember;
  /** City slug the solo team operates in ('calgary', 'edmonton', etc).
   *  Used to register the team's primary_city_id so its job feed is
   *  scoped to the right market instead of always Calgary. */
  teamCitySlug: string;
  /** HQ address — the solo team's base of operations. Travel time on
   *  every booking is calculated FROM this point. Captured at sign-up
   *  on the Your team step, mirroring how the company-onboarding flow
   *  captures `company.hqAddress`. */
  teamHqAddress: string;
  teamHqLat?: number;
  teamHqLng?: number;
  setTeamDriver: (m: Partial<TeamMember>) => void;
  setTeamMover: (m: Partial<TeamMember>) => void;
  setTeamCitySlug: (slug: string) => void;
  setTeamHq: (patch: { address: string; lat?: number; lng?: number }) => void;

  // Company onboarding state
  company: CompanyDraft;
  setCompany: (patch: Partial<CompanyDraft>) => void;
  setDriverCount: (n: number) => void;
  upsertDriver: (id: string, patch: Partial<CompanyDriver>) => void;
  resetPartner: () => void;
}

const blankMember: TeamMember = { fullName: '', email: '', phone: '', licenseNumber: '' };

const blankCompany: CompanyDraft = {
  companyName: '',
  registration: '',
  phone: '',
  email: '',
  city: 'Calgary',
  hqAddress: '',
  driverCount: 2,
  truckCount: 1,
  drivers: [
    { id: 'd1', fullName: '', licenseNumber: '', phone: '', email: '' },
    { id: 'd2', fullName: '', licenseNumber: '', phone: '', email: '' },
  ],
};

export const usePartnerStore = create<PartnerState>((set) => ({
  teamDriver: blankMember,
  teamMover: blankMember,
  teamCitySlug: 'calgary',
  teamHqAddress: '',
  teamHqLat: undefined,
  teamHqLng: undefined,
  setTeamDriver: (m) => set((s) => ({ teamDriver: { ...s.teamDriver, ...m } })),
  setTeamMover: (m) => set((s) => ({ teamMover: { ...s.teamMover, ...m } })),
  setTeamCitySlug: (teamCitySlug) => set({ teamCitySlug }),
  setTeamHq: ({ address, lat, lng }) =>
    set({ teamHqAddress: address, teamHqLat: lat, teamHqLng: lng }),

  company: blankCompany,
  setCompany: (patch) => set((s) => ({ company: { ...s.company, ...patch } })),

  setDriverCount: (n) =>
    set((s) => {
      const next = Math.max(1, Math.min(50, n));
      const drivers = [...s.company.drivers];
      // grow
      while (drivers.length < next) {
        drivers.push({
          id: `d${drivers.length + 1}_${Math.random().toString(36).slice(2, 6)}`,
          fullName: '',
          licenseNumber: '',
          phone: '',
          email: '',
        });
      }
      // shrink
      if (drivers.length > next) drivers.length = next;
      return { company: { ...s.company, driverCount: next, drivers } };
    }),

  upsertDriver: (id, patch) =>
    set((s) => ({
      company: {
        ...s.company,
        drivers: s.company.drivers.map((d) => (d.id === id ? { ...d, ...patch } : d)),
      },
    })),

  resetPartner: () =>
    set({
      teamDriver: blankMember,
      teamMover: blankMember,
      teamCitySlug: 'calgary',
      teamHqAddress: '',
      teamHqLat: undefined,
      teamHqLng: undefined,
      company: blankCompany,
    }),
}));
