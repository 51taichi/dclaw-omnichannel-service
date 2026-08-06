# WhatsApp Header Logo Design

## Goal

Replace the right-side `WhatsApp` text badge with the supplied 256×256 WhatsApp JPEG logo in both the workspace and administrator headers.

## Scope

- Store one local static logo asset under `public/console/assets/`.
- Render the same asset in `public/console/index.html` and `public/admin/index.html`.
- Preserve the existing right-side header position, accessible label, responsive behavior, and left-side DClaw branding.
- Do not modify any other repository or deployed service in this change.

## Presentation

The logo is displayed as a compact square with preserved aspect ratio. The source image already includes its green background and white mark, so no recoloring or image generation is required.

## Verification

- Add/update boundary tests for both header templates.
- Run the relevant UI tests and the full Node test suite.
- Render or inspect both pages to confirm the logo remains aligned at desktop and narrow widths.
