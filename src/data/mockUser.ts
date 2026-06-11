export const mockUser = {
  id: 'u_1',
  name: 'Adam Hmedat',
  email: 'adam@movvy.ca',
  phone: '+1 (587) 555-0142',
  city: 'Calgary, AB',
  joinedAt: '2026-01-12',
  savedAddresses: [
    { label: 'Home', line1: '1212 17 Ave SW', city: 'Calgary', province: 'AB', postal: 'T2T 0B8' },
    { label: 'Work', line1: '215 9 Ave SW', city: 'Calgary', province: 'AB', postal: 'T2P 1K3' },
  ],
  paymentMethods: [
    { id: 'pm_1', brand: 'Visa', last4: '4242', exp: '04/29', default: true },
    { id: 'pm_2', brand: 'Mastercard', last4: '8112', exp: '11/27', default: false },
  ],
};
