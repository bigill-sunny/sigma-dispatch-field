# Sigma Dispatch Operations
Extract the ZIP and run Start.cmd with Node.js 24 or newer. The shared SQLite database is created on first launch. Initial password hashing for 1,103 accounts can take a minute or more. Schedules persist across restarts. Use separate browser profiles for simultaneous roles.

| Role | IDs | Example password |
| --- | --- | --- |
| Dispatch | 1001–1003 | Admin-1001-demo |
| Client | 2001–2100 | Client-2100-demo |
| Guard | 3001–4000 | Guard-4000-demo |

Use the matching ID in each password. All records are fictional. New installations start a weekly board relative to the current time. The first two requests are a ten-guard event surge and a covered supervisor post beginning in 30 minutes. Guard 3019 can cancel that assignment in My shifts. The other 98 sites have recurring staffing needs represented by a week of partially and fully staffed posts. Clients can submit new requests at any time.

Dispatch sends an offer wave, guards volunteer or decline, and dispatch approves each assignment. Guards acknowledge site instructions. Expired offers leave the post open for another wave or manual escalation. Run node verify.js for repeatable checks of these workflows.

## Alerts
In the guard workspace, open My shifts. Enable in-app alerts for the visual pulse, sound and vibration. The banner pulses twice on new offers and respects reduced motion. Turn phone alerts on registers the signed-in device for background rush alerts. The lock screen shows a generic message. A guard opens the app to see current offers. Signing out removes the server subscription for that session.

For phones, serve the shared edition on HTTPS with SIGMA_HOST and SIGMA_ORIGIN configured for the public-facing reverse proxy. Set SIGMA_PUSH_CONTACT to a monitored mailto address. The server needs outbound HTTPS to the browser push service. On iPhone, add the app to the Home Screen before enabling notifications. Delivery depends on browser support, connectivity, permission and device settings. Browser acceptance or notification delivery does not count as a guard response.

Open Sigma Dispatch.html is the browser-local edition. It supports in-app alerts. Shared devices and background push require the server edition. On shared devices sign out when switching accounts.

A dispatcher takes follow-up personally. The review is due in five minutes or at shift start, whichever comes first. Another dispatcher can take over. Coverage and acknowledgment are tracked separately. Area travel times and attendance records are fictional, and hours reflect only assignments on this board.
## Booking and follow-up
Regular bookings appear in Offers & swaps for eligible guards. A rush booking also invites a targeted group immediately. Reply deadlines apply to invitations. Dispatch approves volunteers and can remove an assignment or reoffer an individual post with different hours. A revised post needs fresh acceptance and approval.

Use Week by site to select a booking. Guard record and phone follow-up shows fictional contact numbers and records the outcome of a manual call. In a completed assignment, select its guard to record an attendance and report-quality assessment. The client sees coverage milestones without guard contact information.

For email practice, sign in as client 2001 and paste “Need 3 guards at Maple Junction in two hours for 4 hours.” Review the extracted draft before submission. For a fictional phone request, select Phone and enter the spoken details. These examples supplement the generated week.

Run node verify.js for the staffing checks. With Node.js 24+, Playwright and Microsoft Edge installed, node verify-50.cjs launches an isolated in-memory SQLite server and exercises 50 bookings in separate authenticated browser sessions on localhost. It uses fictional data and records simulated call outcomes.
