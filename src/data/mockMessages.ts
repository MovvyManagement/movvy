import type { ChatMessage } from '@/types';

export const mockMessages: ChatMessage[] = [
  { id: 'm1', from: 'them', body: "Hey! I'm Marcus, your driver. ETA 7 min.", at: '2026-05-20T15:42:00Z' },
  { id: 'm2', from: 'me', body: 'Awesome, thanks. Buzz #404 when you arrive.', at: '2026-05-20T15:43:00Z' },
  { id: 'm3', from: 'them', body: 'Will do. Parking out front?', at: '2026-05-20T15:43:30Z' },
  { id: 'm4', from: 'me', body: 'Yep, loading zone for 30 min.', at: '2026-05-20T15:44:00Z' },
  { id: 'm5', from: 'admin', body: 'Movvy Support: We are monitoring your move. Tap here if you need help.', at: '2026-05-20T15:45:00Z' },
];

export const mockThreads = [
  { id: 't1', name: 'Marcus Lee', last: 'Will do. Parking out front?', at: '2026-05-20T15:43:30Z', unread: 0 },
  { id: 't2', name: 'Movvy Support', last: 'Let us know if we can help on your next move.', at: '2026-04-08T19:00:00Z', unread: 0 },
  { id: 't3', name: 'Priya Sandhu', last: 'All assembled. Have a great day!', at: '2026-04-08T15:00:00Z', unread: 0 },
];
