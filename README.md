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

## Reminders, standby, and client ratings

Confirmed shifts show an in-app reminder up to one hour before start. The shared server checks for reminders every 15 seconds and can send a generic phone notification to registered devices within the notification retention window. The guard can enable a travel alert on a confirmed shift. Location stays in the open browser and is cleared on sign-out, cancellation, or shift start. Travel time uses distance to a fictional site, a 35 km/h assumed speed, and a 10-minute arrival buffer. It does not use live traffic or routing.

In a request, open **Standby coverage** to invite one eligible general guard or supervisor. The guard must accept and remain available. Dispatch can release the standby or approve them for a matching vacancy. Dispatch can also send a rush offer to all remaining eligible, rush-opted-in guards. Guards reply through the offer and dispatch retains assignment approval.

After a staffed shift ends, the requesting client can leave one service rating and a note. The rating is a site-level service evaluation and applies to the guards who worked that shift. Dispatch sees a recommendation score using on-time history (40%), report quality (25%), attendance with cancellations (20%), and site feedback (15%). Unrated sites use the other three metrics. Feedback gets one third of its full weight for each shift rating, up to three ratings. Eligibility and travel limits still apply. The score supports manager review.

Run node verify-enhancements.cjs to exercise standby, client rating permissions, ranking, rush broadcast, and reminder timing with a simulated push service.

## Dispatch automation

Guards can check in from 15 minutes before start until shift end. Dispatch can confirm arrival separately from the site brief. The shared server flags missing arrivals five minutes after start. Dispatch can record a no-show on an in-progress shift and open a linked request for the remainder. The original record preserves the no-show. The recovery start allows travel time and is a target for the replacement, not a promise of uninterrupted coverage.

The shared server checks deadlines every 15 seconds. It can send another rush wave when nobody eligible has replied, recommend an accepted standby for a matching vacancy, or record follow-up due. Set SIGMA_DUTY_DISPATCHER to the name of the dispatcher responsible for automatic follow-ups. Guards who opt into standby may receive an invitation for a near-term sole-supervisor request. They still accept personally, and dispatch approves deployment.

Tight rush offers request the guard's travel estimate. An estimate is checked again at approval and can be updated by the guard. Provider-accepted push, retry pending, failed push, and a guard's reply are distinct. An opted-in phone remains registered up to 30 days after browser-session expiry. Signing out while signed in removes that session's registration.

Coverage plan proposes up to 24 assignments across open requests starting in the next four hours. It uses current volunteers and accepted standbys, prioritizes supervisor and scarce vacancies, and accounts for conflicts across proposals. Dispatch approves the displayed set together. The server recalculates before saving the plan atomically. Independent edits to separate requests can proceed against the current shared roster.

Rest screening uses 24-hour work cycles anchored to the first duty after a break of at least 24 hours. It uses scheduled duties on this board. Sigma should confirm actual work history, exceptions, and operating policies before using the screen for compliance decisions.

Run node verify-automation.cjs for the arrival and scheduling exception drill. The shared server is required for automation to continue when a browser is closed.



## Phone attendance pilot

Run the shared server for attendance. Use separate guard, supervisor, and dispatcher browser profiles or devices. When starting manually, install dependencies with `corepack pnpm install --frozen-lockfile` before running `node server.js`.

1. Dispatch opens the shift and saves an attendance site pin at the designated meeting point. Use the actual coordinates of the fictional pilot location.
2. The guard assigned to the **Supervisor** post signs in. From 15 minutes before start through shift end, the supervisor opens the crew panel and chooses **Show attendance QR**. Their phone must be inside the configured area. Issuing a new QR replaces the previous one. Each code lasts up to three minutes.
3. Each assigned guard signs into their own account, chooses **Scan supervisor QR**, and points their camera at the supervisor's screen. The phone's Camera app can also open the QR link. Choose **Verify location and check in** after scanning. The server checks the guard assignment, supervisor assignment, code and fresh location. The attendance area is 150 metres and the accuracy threshold is 75 metres. The measured distance plus the accuracy radius must fit inside the area.
4. Dispatch and the supervisor can review check-in results. Dispatch can record an attendance exception separately. The server stores the check-in method, time, supervisor, distance and accuracy. Precise coordinates from check-in requests are not retained. Browser location can be spoofed, so physical supervisor oversight still matters.

The assigned supervisor can review volunteers and the assigned crew using five job-specific criteria. Dispatch remains responsible for assignment approval. Pre-shift reviews appear for human review. Post-shift observations on guards with recorded attendance affect the site's deterministic ranking score by up to 8 points. The feedback weight increases with up to three distinct shifts. Feedback cannot waive eligibility checks.

## Deploy the pilot on Render

Connect the private repository to Render and create a Blueprint using render.yaml. Render generates a private SIGMA_PILOT_KEY. Reveal it in the service's Environment settings when signing in on your test devices. It is required alongside each fictional account's password. The service uses the Render HTTPS URL and responds at /health once initialized. Allow time for the first boot to hash the demo passwords.

The Blueprint uses a free web service for the supervised phone pilot. SQLite data and alert registrations are temporary on that plan. Scheduled work pauses when the service sleeps. For an always-on pilot with persistent history, use an authorized paid instance with a disk mounted at /var/data and set SIGMA_DB=/var/data/dispatch.sqlite.

On iPhone, open the HTTPS site in Safari and add it to the Home Screen. Sign into the installed app and enable phone notifications from Schedule. Test delivery with the screen locked during an active server session. Use the same installed app for the in-app QR scan.
