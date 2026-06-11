export const mockEarnings = {
  today: 612,
  week: 3210,
  month: 11240,
  recentPayouts: [
    { id: 'p_22', label: 'Week of May 12', amount: 2890, status: 'paid', date: '2026-05-18' },
    { id: 'p_21', label: 'Week of May 5', amount: 3110, status: 'paid', date: '2026-05-11' },
    { id: 'p_20', label: 'Week of Apr 28', amount: 2640, status: 'paid', date: '2026-05-04' },
  ],
  dailyBars: [340, 410, 290, 520, 612, 0, 0],
  dayLabels: ['M', 'T', 'W', 'T', 'F', 'S', 'S'],
};

export const mockDrivers = [
  { id: 'd_01', name: 'Marcus Lee', status: 'on_job', rating: 4.9, trips: 312, vehicle: '26ft Box Truck' },
  { id: 'd_02', name: 'Priya Sandhu', status: 'online', rating: 4.8, trips: 188, vehicle: '16ft Cube Van' },
  { id: 'd_03', name: 'Diego Alvarez', status: 'offline', rating: 4.7, trips: 92, vehicle: '24ft Box Truck' },
  { id: 'd_04', name: 'Hana Park', status: 'online', rating: 5.0, trips: 41, vehicle: 'Cargo Van' },
];
