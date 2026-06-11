// =============================================================================
// /(customer)/notifications — in-app inbox (customer surface)
//
// The list + row UI is shared across all three surfaces (see
// src/components/NotificationsInbox). This route just pins it to the customer
// surface so tapped rows deep-link into /(customer)/* screens.
// =============================================================================

import React from 'react';
import { NotificationsInbox } from '@/components/NotificationsInbox';

export default function CustomerNotifications() {
  return <NotificationsInbox surface="customer" />;
}
