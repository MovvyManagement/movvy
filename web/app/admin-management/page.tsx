// Root /admin-management — just redirects.
// Auth state already resolved in middleware, so we can trust the redirect
// direction without checking again here.
import { redirect } from 'next/navigation';

export default function AdminRoot() {
  redirect('/admin-management/dashboard');
}
