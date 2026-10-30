# UI/UX Specification (MVP)

**Target:** React + Vite Single-Page Application (`apps/client`) for College Mini-Project Demo.  
**Mandatory Skill:** All UI development must consult and adhere to `.agents/skills/ui-ux-pro-max/SKILL.md`.  
**Visual Style:** Soft UI Evolution with an accessible sky-blue/emerald palette, restrained depth, visible focus, and subtle motion.
**Source of Truth:** [`design-system/slotify/MASTER.md`](../design-system/slotify/MASTER.md), generated and persisted with `ui-ux-pro-max`.

---

## 1. UI/UX Pro Max Design Directives

Refer to `.agents/skills/ui-ux-pro-max/SKILL.md` for complete design intelligence:
- **Design System & Palette:** `#F0F9FF` background, `#0284C7` primary, `#059669` accent, and semantic status colors.
- **Typography:** Inter/system sans with a functional, responsive hierarchy.
- **Accessibility & Interaction:** WCAG AA contrast, visible focus rings, keyboard-accessible native controls, paste/password-manager support, and reduced-motion handling.
- **Component States:** Always provide explicit loading skeletons, empty states, error banners, and disabled submit buttons during async execution.

---

## 2. Views & Flows

### 2.1 Customer Flow
1. **Public Directory (`/`):** Search input, category filter, cards showing approved businesses and pricing.
2. **Business Profile (`/businesses/:slug`):** Business overview, opening hours, list of active services with duration and price.
3. **Booking Modal / Flow:**
   - Select Service -> Choose Date -> Select available slot (from `/slots` API) -> Select Staff (or 'Any Available') -> Review -> Confirm.
   - Shows success confirmation with appointment details.
4. **My Bookings (`/my-bookings`):** List user's upcoming and past bookings with status badges (`confirmed`, `cancelled`, `completed`, `no_show`).
   - "Cancel Appointment" button for upcoming bookings.

### 2.2 Owner Portal (`/dashboard`)
1. **Business Profile & Hours:** Edit description and weekly schedule intervals; public URL is generated from the business name.
2. **Services Management:** Add/edit/deactivate services (duration, buffer minutes, price).
3. **Staff Management:** Add/edit/deactivate staff, assign qualifications, configure weekly shifts, breaks, and leave.
4. **Exceptions & Closures:** Add/edit/remove holiday closures or block intervals.
5. **Appointments List / Calendar:** View upcoming customer bookings; buttons to mark `completed` or `no_show`.

### 2.3 Platform Admin (`/admin`)
1. **Business Approvals:** List businesses in `pending_approval`; one-click "Approve" or "Reject" (with reason note).

---

## 3. Interaction & State Invariants

- **Advisory UI:** UI displays available slots advisory; handles 409 Conflict gracefully by asking the customer to select a refreshed slot.
- **Accessible Forms:** Clear error messages, disabled buttons during async submissions, and keyboard navigation.
- **Authentication Recovery:** Password reset request/completion and email verification token pages are available from the account flow.
