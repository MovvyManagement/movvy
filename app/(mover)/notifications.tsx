// =============================================================================
// /(mover)/notifications — in-app inbox (driver surface)
//
// Pushed onto the driver Stack (sibling of (tabs)), so back / edge-swipe
// returns to whichever tab the driver came from. Tapped job/booking rows
// deep-link into /(mover)/jobs rather than any customer screen.
// =============================================================================

import React from 'react';
import { NotificationsInbox } from '@/components/NotificationsInbox';

export default function MoverNotifications() {
  return <NotificationsInbox surface="mover" />;
}
