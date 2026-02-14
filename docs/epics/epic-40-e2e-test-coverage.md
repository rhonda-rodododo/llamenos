# Epic 40: E2E Test Coverage Expansion

## Problem
Several important features lack dedicated E2E tests:
- Audit log filtering/pagination
- Shift scheduling (assignment, overlap, fallback)
- Ban bulk import (CSV upload)

## New Test Files

### `tests/audit-log.spec.ts`
- Audit log page loads with entries
- Filtering by actor pubkey works
- Pagination shows correct page counts
- Non-admin cannot access audit log

### `tests/shift-management.spec.ts`
- Create shift with volunteer assignment
- Edit shift times and volunteers
- Delete shift with confirmation
- Fallback group configuration
- Shift status indicator for volunteer

### `tests/ban-management.spec.ts`
- Add single ban with valid phone
- Remove ban
- Bulk ban import via textarea
- Bulk import validates phone format
- Duplicate bans are rejected/handled

## Files
- Create: `tests/audit-log.spec.ts`
- Create: `tests/shift-management.spec.ts`
- Create: `tests/ban-management.spec.ts`
