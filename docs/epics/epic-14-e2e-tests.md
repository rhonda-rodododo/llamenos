# Epic 14: E2E Test Expansion

## Summary
Expanded E2E test coverage from 14 tests to 56 tests across 8 files, covering volunteer flow, notes CRUD, auth guards, theme switching, form validation, and responsive layout.

## Test Files

| File | Tests | Coverage |
|------|-------|----------|
| `tests/smoke.spec.ts` | 4 | Login page load, invalid nsec, redirect, empty submission |
| `tests/admin-flow.spec.ts` | 16 | Full admin CRUD, shift edit/delete, ban removal, search, settings, i18n |
| `tests/volunteer-flow.spec.ts` | 9 | Login, profile setup, limited nav, break toggle, admin page guards |
| `tests/notes-crud.spec.ts` | 6 | Create, view, edit, cancel, grouping, encryption display |
| `tests/auth-guards.spec.ts` | 6 | Unauthenticated redirects, session persistence, API 403 |
| `tests/theme.spec.ts` | 5 | Dark/light/system switching, persistence, login page toggle |
| `tests/form-validation.spec.ts` | 8 | Phone validation, E.164 format, bulk import validation |
| `tests/responsive.spec.ts` | 2 | Mobile hamburger menu, no horizontal overflow |
| **Total** | **56** | |

## Infrastructure
- `tests/helpers.ts`: Shared utilities (loginAsAdmin, loginAsVolunteer, createVolunteerAndGetNsec, completeProfileSetup, uniquePhone)
- `playwright.config.ts`: Added `mobile-chromium` project with Pixel 7 device for responsive tests
- State isolation via unique phone numbers per test (timestamp suffix)
