import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { LoadingBlock } from './components/ui';
import { AdminGate, AppLayout } from './components/AppLayout';
import { MarketingLayout } from './components/MarketingLayout';
const AdminPage = lazy(() => import('./pages/admin/AdminPage').then((m) => ({ default: m.AdminPage })));
import { AccountPage } from './pages/app/AccountPage';
import { DashboardPage } from './pages/app/DashboardPage';
import { DiscoverPage } from './pages/app/DiscoverPage';
import { MockCheckoutPage } from './pages/app/MockCheckoutPage';
import { OnboardingPage } from './pages/app/OnboardingPage';
import { OpportunityPage } from './pages/app/OpportunityPage';
import { PipelinePage } from './pages/app/PipelinePage';
import { ForgotPasswordPage, LoginPage, ResetPasswordPage, SignupPage } from './pages/auth/AuthPages';
import { FaqPage } from './pages/marketing/FaqPage';
import { HomePage } from './pages/marketing/HomePage';
import { NotFoundPage, PrivacyPage, TermsPage } from './pages/marketing/LegalPages';
import { PricingPage } from './pages/marketing/PricingPage';

export function App() {
  return (
    <Routes>
      <Route element={<MarketingLayout />}>
        <Route index element={<HomePage />} />
        <Route path="pricing" element={<PricingPage />} />
        <Route path="faq" element={<FaqPage />} />
        <Route path="terms" element={<TermsPage />} />
        <Route path="privacy" element={<PrivacyPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="signup" element={<SignupPage />} />
        <Route path="forgot-password" element={<ForgotPasswordPage />} />
        <Route path="reset-password" element={<ResetPasswordPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      <Route path="onboarding" element={<OnboardingPage />} />
      <Route path="app" element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="discover" element={<DiscoverPage />} />
        <Route path="opportunities/:id" element={<OpportunityPage />} />
        <Route path="pipeline" element={<PipelinePage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="billing/mock-checkout" element={<MockCheckoutPage />} />
      </Route>
      <Route path="admin" element={<AppLayout />}>
        <Route element={<AdminGate />}>
          <Route index element={<Suspense fallback={<LoadingBlock />}><AdminPage /></Suspense>} />
        </Route>
      </Route>
    </Routes>
  );
}
