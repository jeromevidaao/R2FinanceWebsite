import { Navigate, Route, Routes } from 'react-router-dom';
import { getToken } from './api/client';
import { Layout } from './components/Layout';
import { AccountAliasesPage } from './pages/AccountAliasesPage';
import { AccountsPage } from './pages/AccountsPage';
import { BudgetPage } from './pages/BudgetPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { InboxPage } from './pages/InboxPage';
import { LoginPage } from './pages/LoginPage';
import { ConnectorsPage } from './pages/ConnectorsPage';
import { MorePage } from './pages/MorePage';
import { PayeesPage } from './pages/PayeesPage';
import { RegisterPage } from './pages/RegisterPage';
import { ReportsPage } from './pages/ReportsPage';
import { SpendingBreakdownPage } from './pages/SpendingBreakdownPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { TransactionsPage } from './pages/TransactionsPage';

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!getToken()) return <Navigate to="/login" replace />;
  return children;
}

/** Full page load of static privacy.html (not SPA shell). */
function PrivacyRedirect() {
  if (typeof window !== 'undefined') {
    window.location.replace('/privacy.html');
  }
  return null;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      {/* Public legal: static file public/privacy.html (Amazon LWA consent URL) */}
      <Route
        path="/privacy"
        element={
          <PrivacyRedirect />
        }
      />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<BudgetPage />} />
        <Route path="accounts" element={<AccountsPage />} />
        <Route path="accounts/:accountId" element={<RegisterPage />} />
        <Route path="aliases" element={<AccountAliasesPage />} />
        <Route path="inbox" element={<InboxPage />} />
        <Route path="transactions" element={<TransactionsPage />} />
        <Route path="categories" element={<CategoriesPage />} />
        <Route path="payees" element={<PayeesPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="reports/spending" element={<SpendingBreakdownPage />} />
        <Route path="connectors" element={<ConnectorsPage />} />
        <Route path="more" element={<MorePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
