import React from 'react';
import { InvoicesScreen } from './(tabs)/invoices';

/** My business → Sales: the invoice list as its own screen, so back returns to where it was opened from. */
export default function SalesScreen() {
  return <InvoicesScreen stacked />;
}
