# Task 6 Report: Collection list and visual editor

## Status

Implemented the approved collection publishing workspace without changing the public UI.

## TDD evidence

### RED

Added the `collectionStatus` rendering-contract test to `src/admin/collection-form.test.js`, then ran:

```text
npm test -- src/admin/collection-form.test.js
```

Result: exit 1. Vitest ran 3 tests; 1 failed and 2 passed. The expected failure was:

```text
TypeError: collectionStatus is not a function
```

### GREEN

Added `collectionStatus` to `src/admin/collection-form.js`, then ran the same focused command.

Result: exit 0. One test file passed; all 3 tests passed.

## Implementation

- Replaced the collections placeholder with list loading, retry UI, status labels, and collection ordering.
- Added create/edit controls, automatic new-collection slugs, publishing state, cover selection, save, delete, and unsaved-change protection.
- Added visual story sequencing with photo selection, removal, captions, drag ordering, and preview.
- Added the exact responsive structural styles from the task brief.
- Preserved DOM-safe dynamic rendering: dynamic titles, captions, and introduction text use `textContent`, form values, DOM properties, or text nodes; fixed templates alone use `innerHTML`.

## Verification evidence

- `npm test -- src/admin/collection-form.test.js`: exit 0; 3/3 tests passed.
- `npm test`: exit 0; 7/7 test files and 67/67 tests passed.
- `npm run lint`: exit 0; no ESLint errors.
- `npm run typecheck`: exit 0; no TypeScript errors.
- `npm run build`: exit 0; Vite 8.0.16 built 22 modules successfully.
- `git diff --check`: exit 0; no whitespace errors.

## Self-review

Reviewed the implementation line-by-line against the task brief and checked the admin API method names and payload shapes. No missing brief items or unrelated public-UI changes were found. Dynamic backend-provided text is not interpolated into HTML.

## Concerns

None.

## Review fixes

Fix commit: `e23fb9c` (`fix: safeguard collection publishing edits`)

### RED

Added behavioral coverage for publishing order, shared unsaved-change state, cancelled SPA
navigation, membership dirty tracking, and recoverable save errors.

The focused review suite exposed a metadata regression:

```text
npm test -- src/admin/collection-save.test.js src/admin/unsaved-changes.test.js src/admin/app-navigation.test.js src/admin/views/collections.test.js
```

Result: exit 1. Four test files ran; 8 tests passed and 1 failed. The expected failing
assertion showed that disabling form controls before constructing `FormData` caused the
save API to receive an empty title instead of `Changed title`.

### GREEN

Moved form serialization ahead of the temporary disabled state and reran the same focused
command.

Result: exit 0. All 4 test files and all 9 tests passed.

### Review-fix verification

- `npm test`: exit 0; 11/11 test files and 76/76 tests passed.
- `npm run lint`: exit 0; no ESLint errors.
- `npm run typecheck`: exit 0; no TypeScript errors.
- `npm run build`: exit 0; Vite 8.0.16 built 24 modules successfully.
- `git diff --check`: exit 0; no whitespace errors.

The extracted save workflow now preserves publication invariants across create, publish,
unpublish, and published-update paths. The centralized admin guard protects navigation and
editor replacement while retaining the current editor and hash on cancellation. Dirty
state covers metadata, captions, membership additions/removals, and reorder operations,
and clears only after a complete save or confirmed discard/deletion. Save failures preserve
edits, re-enable controls, and display the error.
