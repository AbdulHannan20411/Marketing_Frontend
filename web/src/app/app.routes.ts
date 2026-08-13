import type { Routes } from '@angular/router';

import { authGuard, guestGuard } from '@core/guards/auth.guard';
import { featureGuard } from '@core/guards/feature.guard';
import { permissionGuard } from '@core/guards/permission.guard';
import { adminPortalGuard, superAdminPortalGuard } from '@core/guards/portal.guard';
import { scopeGuard } from '@core/guards/scope.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },

  {
    path: 'auth',
    canActivate: [guestGuard],
    children: [
      {
        path: 'login',
        title: 'Sign in',
        data: { portal: 'admin' },
        loadComponent: () =>
          import('@features/auth/login/login.component').then((m) => m.LoginComponent),
      },
      {
        path: 'forgot-password',
        title: 'Reset password',
        loadComponent: () =>
          import('@features/auth/forgot-password/forgot-password.component').then(
            (m) => m.ForgotPasswordComponent,
          ),
      },
      // Both are reached from an emailed link carrying `?token=`. The API's
      // `Email:ClientBaseUrl` must point here rather than at its dev helper.
      {
        path: 'accept-invitation',
        title: 'Accept your invitation',
        data: { mode: 'invitation' },
        loadComponent: () =>
          import('@features/auth/set-password/set-password.component').then(
            (m) => m.SetPasswordComponent,
          ),
      },
      {
        path: 'reset-password',
        title: 'Choose a new password',
        data: { mode: 'reset' },
        loadComponent: () =>
          import('@features/auth/set-password/set-password.component').then(
            (m) => m.SetPasswordComponent,
          ),
      },
      { path: '', pathMatch: 'full', redirectTo: 'login' },
    ],
  },

  /* ------------------------------------------------------------------ *
   * Super Admin portal
   *
   * Its own prefix and navigation. Scoped modules reuse the Admin feature
   * components unchanged — the selected admin is applied by `scopeInterceptor`,
   * so there is no parallel implementation to keep in step.
   * ------------------------------------------------------------------ */
  {
    path: 'superadmin/login',
    canActivate: [guestGuard],
    title: 'Super Admin sign-in',
    data: { portal: 'superadmin' },
    loadComponent: () =>
      import('@features/auth/login/login.component').then((m) => m.LoginComponent),
  },

  {
    path: 'superadmin',
    canActivate: [authGuard, superAdminPortalGuard],
    loadComponent: () => import('@layout/shell/shell.component').then((m) => m.ShellComponent),
    children: [
      {
        path: 'dashboard',
        title: 'Platform overview',
        loadComponent: () =>
          import('@features/superadmin/dashboard/dashboard-switch.component').then(
            (m) => m.SuperAdminDashboardComponent,
          ),
      },
      {
        path: 'admins',
        title: 'Admins',
        loadComponent: () =>
          import('@features/superadmin/admins/admins.component').then(
            (m) => m.SuperAdminAdminsComponent,
          ),
      },
      {
        path: 'reports',
        title: 'Global reports',
        loadComponent: () =>
          import('@features/superadmin/reports/reports-switch.component').then(
            (m) => m.SuperAdminReportsComponent,
          ),
      },

      /* Scoped modules — the picker stands in until an admin is chosen. */
      {
        path: 'contacts',
        title: 'Contacts',
        canActivate: [scopeGuard],
        loadComponent: () =>
          import('@features/contacts/contacts.component').then((m) => m.ContactsComponent),
      },
      {
        path: 'contacts/import',
        title: 'Import contacts',
        canActivate: [scopeGuard],
        loadComponent: () =>
          import('@features/contacts/import/contact-import.component').then(
            (m) => m.ContactImportComponent,
          ),
      },
      {
        path: 'contacts/import/:batchId',
        title: 'Import details',
        canActivate: [scopeGuard],
        loadComponent: () =>
          import('@features/contacts/import/import-detail.component').then(
            (m) => m.ImportDetailComponent,
          ),
      },
      {
        path: 'groups',
        title: 'Groups',
        canActivate: [scopeGuard],
        loadComponent: () =>
          import('@features/groups/groups.component').then((m) => m.GroupsComponent),
      },
      {
        path: 'tags',
        title: 'Tags',
        canActivate: [scopeGuard],
        loadComponent: () => import('@features/tags/tags.component').then((m) => m.TagsComponent),
      },
      {
        path: 'campaigns',
        title: 'Campaigns',
        canActivate: [scopeGuard],
        loadComponent: () =>
          import('@features/campaigns/campaigns.component').then((m) => m.CampaignsComponent),
      },
      {
        path: 'templates',
        title: 'Templates',
        canActivate: [scopeGuard],
        loadComponent: () =>
          import('@features/templates/templates.component').then((m) => m.TemplatesComponent),
      },
      {
        path: 'whatsapp',
        title: 'WhatsApp',
        canActivate: [scopeGuard],
        loadComponent: () =>
          import('@features/whatsapp/whatsapp.component').then((m) => m.WhatsAppComponent),
      },
      {
        path: 'employees',
        title: 'Employees',
        canActivate: [scopeGuard],
        loadComponent: () =>
          import('@features/employees/employees.component').then((m) => m.EmployeesComponent),
      },

      /* Platform-level administration */
      {
        path: 'plans',
        title: 'Plans',
        loadComponent: () =>
          import('@features/admin/plans/plans.component').then((m) => m.PlansComponent),
      },
      {
        path: 'tenants',
        title: 'Tenants',
        loadComponent: () =>
          import('@features/admin/tenants/tenants.component').then((m) => m.TenantsComponent),
      },
      {
        path: 'audit',
        title: 'Audit Logs',
        loadComponent: () =>
          import('@features/admin/audit/audit.component').then((m) => m.AuditComponent),
      },
      {
        path: 'monitoring',
        title: 'Monitoring',
        loadComponent: () =>
          import('@features/admin/monitoring/monitoring.component').then(
            (m) => m.MonitoringComponent,
          ),
      },
      {
        path: 'settings',
        title: 'Settings',
        loadComponent: () =>
          import('@features/settings/settings.component').then((m) => m.SettingsComponent),
      },
      {
        path: 'notifications',
        title: 'Notifications',
        loadComponent: () =>
          import('@features/notifications/notifications.component').then(
            (m) => m.NotificationsComponent,
          ),
      },
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
    ],
  },

  /* ------------------------------------------------------------------ *
   * Admin / Employee portal
   * ------------------------------------------------------------------ */
  {
    path: '',
    canActivate: [authGuard, adminPortalGuard],
    loadComponent: () => import('@layout/shell/shell.component').then((m) => m.ShellComponent),
    children: [
      {
        path: 'dashboard',
        title: 'Dashboard',
        loadComponent: () =>
          import('@features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
      },

      /* ---------------- Audience ---------------- */
      {
        path: 'contacts',
        title: 'Contacts',
        canActivate: [permissionGuard, featureGuard],
        data: { permissions: ['contacts.view'], module: 'crm' },
        loadComponent: () =>
          import('@features/contacts/contacts.component').then((m) => m.ContactsComponent),
      },
      // Declared before `contacts/:id` would be, so the literal wins the match.
      {
        path: 'contacts/import',
        title: 'Import contacts',
        canActivate: [permissionGuard, featureGuard],
        data: { permissions: ['contacts.import'], module: 'crm' },
        loadComponent: () =>
          import('@features/contacts/import/contact-import.component').then(
            (m) => m.ContactImportComponent,
          ),
      },
      {
        path: 'contacts/import/:batchId',
        title: 'Import details',
        canActivate: [permissionGuard, featureGuard],
        data: { permissions: ['contacts.import'], module: 'crm' },
        loadComponent: () =>
          import('@features/contacts/import/import-detail.component').then(
            (m) => m.ImportDetailComponent,
          ),
      },
      {
        path: 'groups',
        title: 'Groups',
        canActivate: [permissionGuard, featureGuard],
        data: { permissions: ['groups.manage'], module: 'crm' },
        loadComponent: () =>
          import('@features/groups/groups.component').then((m) => m.GroupsComponent),
      },
      {
        path: 'tags',
        title: 'Tags',
        canActivate: [permissionGuard, featureGuard],
        data: { permissions: ['tags.manage'], module: 'crm' },
        loadComponent: () => import('@features/tags/tags.component').then((m) => m.TagsComponent),
      },

      /* ---------------- Messaging ---------------- */
      {
        path: 'whatsapp',
        title: 'WhatsApp',
        canActivate: [permissionGuard, featureGuard],
        data: { permissions: ['whatsapp.templates.view', 'whatsapp.connect'], module: 'whatsapp' },
        loadComponent: () =>
          import('@features/whatsapp/whatsapp.component').then((m) => m.WhatsAppComponent),
      },
      {
        path: 'templates',
        title: 'Templates',
        canActivate: [permissionGuard, featureGuard],
        data: { permissions: ['whatsapp.templates.view'], module: 'whatsapp' },
        loadComponent: () =>
          import('@features/templates/templates.component').then((m) => m.TemplatesComponent),
      },
      {
        path: 'campaigns',
        title: 'Campaigns',
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
        title: 'Reports',
        canActivate: [permissionGuard, featureGuard],
        data: { permissions: ['reports.view'], module: 'reporting' },
        loadComponent: () =>
          import('@features/reports/reports.component').then((m) => m.ReportsComponent),
      },

      /* ---------------- Workspace ---------------- */
      {
        path: 'employees',
        title: 'Employees',
        canActivate: [permissionGuard, featureGuard],
        data: { permissions: ['settings.employees'], module: 'employees' },
        loadComponent: () =>
          import('@features/employees/employees.component').then((m) => m.EmployeesComponent),
      },
      {
        path: 'subscription',
        title: 'Subscription',
        canActivate: [permissionGuard],
        data: { permissions: ['settings.subscription'] },
        loadComponent: () =>
          import('@features/subscription/subscription.component').then(
            (m) => m.SubscriptionComponent,
          ),
      },
      {
        path: 'billing',
        title: 'Billing',
        canActivate: [permissionGuard],
        data: { permissions: ['settings.billing'] },
        loadComponent: () =>
          import('@features/billing/billing.component').then((m) => m.BillingComponent),
      },
      {
        path: 'pricing',
        title: 'Plans & pricing',
        loadComponent: () =>
          import('@features/pricing/pricing.component').then((m) => m.PricingComponent),
      },
      {
        path: 'notifications',
        title: 'Notifications',
        loadComponent: () =>
          import('@features/notifications/notifications.component').then(
            (m) => m.NotificationsComponent,
          ),
      },
      {
        path: 'upgrade',
        title: 'Upgrade',
        loadComponent: () =>
          import('@features/upgrade/upgrade.component').then((m) => m.UpgradeComponent),
      },
      {
        path: 'settings',
        title: 'Settings',
        loadComponent: () =>
          import('@features/settings/settings.component').then((m) => m.SettingsComponent),
      },

      // Platform administration lives exclusively under /superadmin.

      {
        path: 'forbidden',
        title: 'No access',
        loadComponent: () =>
          import('@features/errors/forbidden.component').then((m) => m.ForbiddenComponent),
      },
    ],
  },

  { path: '**', redirectTo: 'dashboard' },
];
