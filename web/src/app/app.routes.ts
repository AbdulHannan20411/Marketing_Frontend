import type { Routes } from '@angular/router';

import { authGuard, guestGuard } from '@core/guards/auth.guard';
import { featureGuard } from '@core/guards/feature.guard';
import { permissionGuard } from '@core/guards/permission.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },

  {
    path: 'auth',
    canActivate: [guestGuard],
    children: [
      {
        path: 'login',
        title: 'Sign in · Verdant',
        loadComponent: () =>
          import('@features/auth/login/login.component').then((m) => m.LoginComponent),
      },
      {
        path: 'forgot-password',
        title: 'Reset password · Verdant',
        loadComponent: () =>
          import('@features/auth/forgot-password/forgot-password.component').then(
            (m) => m.ForgotPasswordComponent,
          ),
      },
      { path: '', pathMatch: 'full', redirectTo: 'login' },
    ],
  },

  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('@layout/shell/shell.component').then((m) => m.ShellComponent),
    children: [
      {
        path: 'dashboard',
        title: 'Dashboard · Verdant',
        loadComponent: () =>
          import('@features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
      },

      /* ---------------- Audience ---------------- */
      {
        path: 'contacts',
        title: 'Contacts · Verdant',
        canActivate: [permissionGuard, featureGuard],
        data: { permissions: ['contacts.view'], module: 'crm' },
        loadComponent: () =>
          import('@features/contacts/contacts.component').then((m) => m.ContactsComponent),
      },
      {
        path: 'groups',
        title: 'Groups · Verdant',
        canActivate: [permissionGuard, featureGuard],
        data: { permissions: ['groups.manage'], module: 'crm' },
        loadComponent: () =>
          import('@features/groups/groups.component').then((m) => m.GroupsComponent),
      },
      {
        path: 'tags',
        title: 'Tags · Verdant',
        canActivate: [permissionGuard, featureGuard],
        data: { permissions: ['tags.manage'], module: 'crm' },
        loadComponent: () => import('@features/tags/tags.component').then((m) => m.TagsComponent),
      },

      /* ---------------- Messaging ---------------- */
      {
        path: 'whatsapp',
        title: 'WhatsApp · Verdant',
        canActivate: [permissionGuard, featureGuard],
        data: { permissions: ['whatsapp.templates.view', 'whatsapp.connect'], module: 'whatsapp' },
        loadComponent: () =>
          import('@features/whatsapp/whatsapp.component').then((m) => m.WhatsAppComponent),
      },
      {
        path: 'templates',
        title: 'Templates · Verdant',
        canActivate: [permissionGuard, featureGuard],
        data: { permissions: ['whatsapp.templates.view'], module: 'whatsapp' },
        loadComponent: () =>
          import('@features/templates/templates.component').then((m) => m.TemplatesComponent),
      },
      {
        path: 'campaigns',
        title: 'Campaigns · Verdant',
        canActivate: [permissionGuard, featureGuard],
        data: {
          permissions: ['whatsapp.campaigns.reports', 'whatsapp.campaigns.create'],
          module: 'whatsapp',
        },
        loadComponent: () =>
          import('@features/campaigns/campaigns.component').then((m) => m.CampaignsComponent),
      },

      /* ---------------- Insights ---------------- */
      {
        path: 'reports',
        title: 'Reports · Verdant',
        canActivate: [permissionGuard, featureGuard],
        data: { permissions: ['reports.view'], module: 'reporting' },
        loadComponent: () =>
          import('@features/reports/reports.component').then((m) => m.ReportsComponent),
      },

      /* ---------------- Workspace ---------------- */
      {
        path: 'employees',
        title: 'Employees · Verdant',
        canActivate: [permissionGuard, featureGuard],
        data: { permissions: ['settings.employees'], module: 'employees' },
        loadComponent: () =>
          import('@features/employees/employees.component').then((m) => m.EmployeesComponent),
      },
      {
        path: 'subscription',
        title: 'Subscription · Verdant',
        canActivate: [permissionGuard],
        data: { permissions: ['settings.subscription'] },
        loadComponent: () =>
          import('@features/subscription/subscription.component').then(
            (m) => m.SubscriptionComponent,
          ),
      },
      {
        path: 'billing',
        title: 'Billing · Verdant',
        canActivate: [permissionGuard],
        data: { permissions: ['settings.billing'] },
        loadComponent: () =>
          import('@features/billing/billing.component').then((m) => m.BillingComponent),
      },
      {
        path: 'pricing',
        title: 'Plans & pricing · Verdant',
        loadComponent: () =>
          import('@features/pricing/pricing.component').then((m) => m.PricingComponent),
      },
      {
        path: 'notifications',
        title: 'Notifications · Verdant',
        loadComponent: () =>
          import('@features/notifications/notifications.component').then(
            (m) => m.NotificationsComponent,
          ),
      },
      {
        path: 'upgrade',
        title: 'Upgrade · Verdant',
        loadComponent: () =>
          import('@features/upgrade/upgrade.component').then((m) => m.UpgradeComponent),
      },
      {
        path: 'settings',
        title: 'Settings · Verdant',
        canActivate: [permissionGuard],
        data: {
          title: 'Settings',
          description: 'Workspace, team and billing configuration.',
          permissions: ['settings.company'],
        },
        loadComponent: () =>
          import('@features/placeholder/placeholder.component').then((m) => m.PlaceholderComponent),
      },

      /* ---------------- Platform administration ---------------- */
      {
        path: 'admin',
        canActivate: [permissionGuard],
        data: { roles: ['SuperAdmin'] },
        children: [
          {
            path: 'tenants',
            title: 'Tenants · Verdant',
            loadComponent: () =>
              import('@features/admin/tenants/tenants.component').then((m) => m.TenantsComponent),
          },
          {
            path: 'plans',
            title: 'Plans · Verdant',
            loadComponent: () =>
              import('@features/admin/plans/plans.component').then((m) => m.PlansComponent),
          },
          {
            path: 'audit',
            title: 'Audit Logs · Verdant',
            loadComponent: () =>
              import('@features/admin/audit/audit.component').then((m) => m.AuditComponent),
          },
          {
            path: 'monitoring',
            title: 'Monitoring · Verdant',
            loadComponent: () =>
              import('@features/admin/monitoring/monitoring.component').then(
                (m) => m.MonitoringComponent,
              ),
          },
          { path: '', pathMatch: 'full', redirectTo: 'tenants' },
        ],
      },

      {
        path: 'forbidden',
        title: 'No access · Verdant',
        loadComponent: () =>
          import('@features/errors/forbidden.component').then((m) => m.ForbiddenComponent),
      },
    ],
  },

  { path: '**', redirectTo: 'dashboard' },
];
