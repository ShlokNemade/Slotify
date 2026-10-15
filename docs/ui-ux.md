# UI/UX Specification

**Status:** proposed. Latest style choice supersedes the earlier navy/cream reference.

## Visual direction
Modern white/neutral SaaS dashboard with restrained accents, clear hierarchy, compact data cards, and status colors used semantically rather than decoratively.

## Areas and navigation
### Customer
Directory, business profile, guided booking, booking confirmation/details, upcoming/past bookings, notification center, account/security settings.

### Owner
Persistent left sidebar:
- Calendar
- Bookings
- Services
- Staff
- Customers
- Availability
- Analytics
- Protection
- Settings

### Platform admin
Separate navigation and area for overview/health, tenant review, rate-limit monitoring, queue/notification health, and administrative activity. Hiding a link is not authorization; APIs must enforce permissions.

## Calendar and booking flow
- Owner calendar defaults to weekly view, with day and month views.
- Distinguish confirmed bookings, open availability, blocked periods, and conflicts.
- Mobile uses a compact day/agenda presentation.
- Customer flow: select business → services/order → staff per service → date/time → review → confirm.
- Confirmation is shown only after authoritative server response.
- On conflict, preserve still-valid choices, explain what changed, refresh availability, and require explicit reconfirmation.
- No automatic partial booking.

## Directory/profile
- Filters: category, location, service, date, displayed price.
- Optional device location with permission; nearest-first when available, otherwise relevance.
- Public profiles show description, services/prices, staff display names, hours, and bookable slots only.
- Slug change behavior for old URLs remains open.

## Protection UX
Explain blocked action, restriction category, and expiry if temporary. Do not reveal internal risk scores or precise detection logic. Provide owner contact path. Owner lifts restrictions with an audit record.

## Responsive/accessibility
Fully responsive desktop and mobile. Semantic controls, keyboard navigation, visible focus, sufficient contrast, accessible errors, labels, and no color-only status communication. Provide loading, empty, error, success, and stale-availability states.
