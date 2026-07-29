# PWA Installability v1

Status: Implemented
Date: July 29, 2026

## Purpose

Dayflow should be installable through browser-managed desktop and home-screen
surfaces when the browser supports installation. PWA Installability v1 gives
the existing local web application a stable installed identity without
changing its data, network, or runtime model.

## Public Manifest Contract

`GET /manifest.webmanifest` is a public application interface. It returns a
web app manifest with:

- `id`, `start_url`, and `scope` set to `/`;
- `name` and `short_name` set to `Dayflow`;
- `lang` set to `en`;
- the description `A local-first personal workspace for deciding, planning,
  recording, capturing, and reviewing.`;
- `display` set to `standalone`;
- background and theme colors set to Dayflow's warm canvas, `#f8f6f0`;
- `prefer_related_applications` set to `false`; and
- these PNG icon entries:
  - `/icons/dayflow-192.png`, 192×192, general purpose;
  - `/icons/dayflow-512.png`, 512×512, general purpose; and
  - `/icons/dayflow-maskable-512.png`, 512×512, maskable.

The manifest route returns the manifest JSON content type. Manifest icon URLs
are root-relative, stable, and publicly retrievable.

## Installed Identity

The icon family is a deterministic rendering of the existing Dayflow brand:
a warm canvas, dark rounded mark, and light serif “D”. The mark remains inside
the maskable safe area so operating systems can crop the maskable icon without
removing its identity.

The rendered document head exposes:

- the manifest link;
- a general PNG icon;
- a 180×180 Apple touch icon;
- the Dayflow theme color; and
- Apple standalone-web-app metadata with the title `Dayflow`.

The icon files use their declared PNG media type and exact pixel dimensions.

## Runtime Contract

Installation changes the launch surface, not Dayflow's architecture:

- the installed app opens at `/` in a standalone display surface where the
  browser and operating system support it;
- all existing local SQLite and Next.js behavior remains authoritative; and
- the local Dayflow server must still be running and reachable.

Installation is origin-bound. In the default setup, `npm run dev` binds
Dayflow to `127.0.0.1`, so the installed app is a same-machine launch surface.
Installation does not package or start Next.js, copy the SQLite database, or
make that loopback address reachable from a phone or another device. Changing
the hostname or port produces a distinct installed web-app identity.

Browser and operating-system policy ultimately control whether and how an
install action is presented. Dayflow does not promise a particular prompt,
menu label, or installation UI.

## Non-Goals

- A service worker, offline document shell, or request caching.
- Offline SQLite access or operation while the local Next.js server is
  stopped.
- Background sync, push notifications, periodic tasks, or update prompts.
- A custom install button or interception of the browser install prompt.
- Changes to data storage, migrations, APIs, navigation, or product workflow.
- A claim that installability guarantees installation on every browser or
  operating system.

## Acceptance Criteria

1. `/manifest.webmanifest` returns the complete public manifest contract.
2. Every declared icon URL returns a PNG with its declared dimensions.
3. The maskable icon keeps the Dayflow mark within its safe area.
4. The rendered document head links the manifest and branded icons and
   contains theme and Apple standalone metadata.
5. Existing functionality and the complete repository quality gate remain
   green.
6. No service worker or offline capability is introduced or claimed.

## Required Coverage

- Browser-level HTTP coverage of the manifest status, content type, values,
  and icon declarations.
- Browser-level HTTP coverage of each PNG media type and dimensions.
- Rendered-head coverage for manifest, icon, theme-color, and Apple
  metadata, including Chromium manifest discovery.
- Visual inspection of the deterministic icon family.
- The complete typecheck, unit, integration, migration, production-build, and
  Chromium browser gates.

## Implementation Record

Implemented July 29, 2026.

- A typed App Router manifest publishes the stable Dayflow identity, launch
  scope, warm theme, and separate general-purpose and maskable icons.
- The rendered head includes stable browser and Apple icons, theme and
  standalone metadata, and a manifest link that Chromium discovers without
  parse errors.
- Five checked-in PNGs are generated from font-independent geometric artwork;
  repeat generation produced identical file hashes, and the normal, maskable,
  Apple, and 32-pixel variants were visually inspected.
- No service worker, cache layer, install prompt, or offline claim was added.
- The complete `npm run check` reliability gate passed on July 29, 2026:
  137 unit tests, 14 backup/integration tests, all migration fixtures, the
  production build, and 103 Chromium browser tests.
