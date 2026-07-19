// =============================================================================
// /(company)/notifications — in-app inbox (company surface)
//
// Pushed onto the company Stack (sibling of (tabs)), so back / edge-swipe
// returns to whichever tab the dispatcher came from. Tapped job/booking rows
// deep-link into /(company)/(tabs)/jobs rather than any customer screen.
// =============================================================================

import React from 'react';
import { NotificationsInbox } from '@/components/NotificationsInbox';

export default function CompanyNotifications() {
  return <NotificationsInbox surface="company" />;
}
