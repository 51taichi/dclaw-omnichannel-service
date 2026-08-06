# WhatsApp Header Logo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Replace the workspace and administrator header's right-side WhatsApp text badge with the supplied local logo image.

**Architecture:** Add one shared static JPEG under the existing console asset directory. Both HTML entry points reference that asset and the existing shared platform-logo CSS receives a focused image rule so layout behavior remains unchanged.

**Tech Stack:** Static HTML, CSS, Node.js built-in test runner.

## Global Constraints

- Modify only the current `dclaw-omnichannel-service` repository.
- Preserve the left-side DClaw brand, header structure, accessible label, and responsive layout.
- Use the supplied 256×256 JPEG without recoloring or regenerating it.

---

### Task 1: Add the shared logo and header contract

**Files:**
- Create: `public/console/assets/whatsapp-logo.jpg`
- Modify: `public/console/index.html`
- Modify: `public/admin/index.html`
- Modify: `public/console/styles.css`
- Modify: `tests/console-auth-boundary.test.js`
- Modify: `tests/admin-console-boundary.test.js`

**Interfaces:**
- Consumes: `/console/assets/whatsapp-logo.jpg` as a public static asset.
- Produces: `.platform-logo.whatsapp img` in both header templates.

- [x] **Step 1: Add failing template assertions**

Assert that both HTML files contain an image using `/console/assets/whatsapp-logo.jpg`, preserve `aria-label="WhatsApp / Whapi.Cloud"`, and no longer render `>WhatsApp</span>`.

- [x] **Step 2: Run focused tests and confirm failure**

```bash
node --test tests/console-auth-boundary.test.js tests/admin-console-boundary.test.js
```

Expected: failure because the image element is not present.

- [x] **Step 3: Add the asset and minimal markup/CSS**

Use this markup in both headers:

```html
<span class="platform-logo whatsapp" aria-label="WhatsApp / Whapi.Cloud">
  <img src="/console/assets/whatsapp-logo.jpg" alt="" aria-hidden="true" />
</span>
```

Size the image as a compact square with `display: block`, `object-fit: cover`, and a small corner radius.

- [x] **Step 4: Run focused and full verification**

```bash
node --test tests/console-auth-boundary.test.js tests/admin-console-boundary.test.js
node --test
node --check public/console/app.js
git diff --check
```

Expected: zero failures and clean syntax/diff checks.

- [x] **Step 5: Commit**

```bash
git add public/console/assets/whatsapp-logo.jpg public/console/index.html public/admin/index.html public/console/styles.css tests/console-auth-boundary.test.js tests/admin-console-boundary.test.js docs/superpowers/plans/2026-08-06-whatsapp-header-logo.md
git commit -m "feat: show whatsapp logo in headers"
```
