import type { Routes } from '@angular/router';

import { authGuard, guestGuard } from '@core/guards/auth.guard';
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
      {
        path: 'contacts',
        title: 'Contacts · Verdant',
        canActivate: [permissionGuard],
        data: { permissions: ['contacts.read'] },
        loadComponent: () =>
          import('@features/contacts/contacts.component').then((m) => m.ContactsComponent),
      },
      {
        path: 'groups',
        title: 'Groups · Verdant',
        canActivate: [permissionGuard],
        data: { permissions: ['groups.manage'] },
        loadComponent: () =>
          import('@features/groups/groups.component').then((m) => m.GroupsComponent),
      },
      {
        path: 'tags',
        title: 'Tags · Verdant',
        canActivate: [permissionGuard],
        data: { permissions: ['tags.manage'] },
        loadComponent: () => import('@features/tags/tags.component').then((m) => m.TagsComponent),
      },
      {
        path: 'whatsapp',
        title: 'WhatsApp · Verdant',
        canActivate: [permissionGuard],
        data: { permissions: ['whatsapp.read'] },
        loadComponent: () =>
          import('@features/whatsapp/whatsapp.component').then((m) => m.WhatsAppComponent),
      },
      {
        path: 'templates',
        title: 'Templates · Verdant',
        canActivate: [permissionGuard],
        data: { permissions: ['templates.read'] },
        loadComponent: () =>
          import('@features/templates/templates.component').then((m) => m.TemplatesComponent),
      },
      {
        path: 'campaigns',
        title: 'Campaigns · Verdant',
        canActivate: [permissionGuard],
        data: { permissions: ['campaigns.read'] },
        loadComponent: () =>
          import('@features/campaigns/campaigns.component').then((m) => m.CampaignsComponent),
      },
      {
        path: 'reports',
        title: 'Reports · Verdant',
        canActivate: [permissionGuard],
        data: { permissions: ['reports.read'] },
        loadComponent: () =>
          import('@features/reports/reports.component').then((m) => m.ReportsComponent),
      },
      {
        path: 'settings',
        title: 'Settings · Verdant',
        canActivate: [permissionGuard],
        data: {
          title: 'Settings',
          description: 'Workspace, team and billing configuration.',
          permissions: ['settings.manage'],
        },
        loadComponent: () =>
          import('@features/placeholder/placeholder.component').then((m) => m.PlaceholderComponent),
      },

      {
        path: 'admin',
        canActivate: [permissionGuard],
        data: { roles: ['PlatformAdmin'] },
        children: [
          {
            path: 'tenants',
            title: 'Tenants · Verdant',
            loadComponent: () =>
              import('@features/admin/tenants/tenants.component').then((m) => m.TenantsComponent),
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
