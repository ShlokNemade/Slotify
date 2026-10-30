import { useEffect, useState } from 'react';
import { Shell } from './components/Shell.jsx';
import { currentLocation, navigateTo } from './lib/router.js';
import { DirectoryPage } from './pages/DirectoryPage.jsx';
import { ProfilePage } from './pages/ProfilePage.jsx';
import { ConfirmPage } from './pages/ConfirmPage.jsx';
import { MyBookingsPage } from './pages/MyBookingsPage.jsx';
import { AuthPage } from './pages/AuthPage.jsx';
import { OwnerDashboardPage } from './pages/OwnerDashboardPage.jsx';
import { AdminDashboardPage } from './pages/AdminDashboardPage.jsx';
import { PasswordResetPage } from './pages/PasswordResetPage.jsx';
import { VerifyEmailPage } from './pages/VerifyEmailPage.jsx';

export function App() {
  const [location, setLocation] = useState(currentLocation);
  useEffect(() => {
    const handlePopState = () => setLocation(currentLocation());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);
  const onNavigate = (path) => navigateTo(path);
  let page = <DirectoryPage onNavigate={onNavigate} />;
  if (location.pathname === '/my-bookings') page = <MyBookingsPage onNavigate={onNavigate} />;
  else if (location.pathname.startsWith('/businesses/')) page = <ProfilePage slug={location.pathname.split('/')[2]} onNavigate={onNavigate} />;
  else if (location.pathname === '/confirm') page = <ConfirmPage params={location.searchParams} onNavigate={onNavigate} />;
  else if (location.pathname === '/account') page = <AuthPage onNavigate={onNavigate} />;
  else if (location.pathname === '/account/reset') page = <PasswordResetPage token={location.searchParams.get('token') ?? ''} onNavigate={onNavigate} />;
  else if (location.pathname === '/account/verify') page = <VerifyEmailPage token={location.searchParams.get('token') ?? ''} onNavigate={onNavigate} />;
  else if (location.pathname === '/owner') page = <OwnerDashboardPage onNavigate={onNavigate} />;
  else if (location.pathname === '/admin') page = <AdminDashboardPage />;
  return <Shell onNavigate={onNavigate}>{page}</Shell>;
}
