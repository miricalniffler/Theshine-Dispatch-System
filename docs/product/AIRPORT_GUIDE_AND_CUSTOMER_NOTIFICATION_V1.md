# Theshine Dispatch System — Airport Guide & Customer Notification v1.0

**Status:** Approved for implementation planning  
**Scope:** Phase 2 — Airport guide library, customer WhatsApp notifications, customer reply understanding, and operational exception handling

## 1. Product objective

Add a lightweight customer-communication workflow to the dispatch system without turning the product into a full customer-service CRM.

The system should:

1. Send a first WhatsApp contact to applicable customers, manually when the operator chooses or automatically at T-24h as a fallback.
2. Ask the customer to confirm core order information and provide luggage information.
3. For airport pickup orders, automatically attach the correct airport pickup guide when available.
4. Understand customer replies sufficiently to record confirmations/luggage and surface exceptions.
5. After driver/vehicle information is formally returned to i’way, immediately send that confirmed driver/vehicle information to the customer.
6. Keep AI focused on understanding ambiguous customer replies. Do not use AI for airport recognition or free-form automatic customer service in V1.
7. Only surface situations that require human intervention.

## 2. Core product principles

- **Business action = workflow fact.** Do not add artificial confirmation/status buttons when an existing real action already proves the state.
- **Manual first, automation as fallback.** The operator may proactively send first-contact messages; T-24h ensures messages are not missed when the operator is offline.
- **Normal cases should be quiet; exceptions should seek attention.**
- **AI may understand, but must not autonomously alter source order data.**
- **Do not block useful communication because an optional enhancement is unavailable.** Missing airport-guide material must not prevent the rest of the first contact from being sent.
- **Regional configuration, not hard-coded cities.** Customer WhatsApp automation can be enabled or disabled per operating region.

## 3. Scope

### 3.1 In scope

- Airport pickup guide library.
- Deterministic airport recognition and guide matching.
- Regional enable/disable setting for customer WhatsApp notifications.
- Manual batch first-contact action from the active order dashboard.
- Automatic first contact at T-24h.
- First-contact templates for pickup and non-pickup orders.
- Customer reply ingestion and classification.
- Structured luggage extraction and order luggage fields.
- Luggage/capacity risk detection.
- Detection of customer-reported order discrepancies.
- Immediate second-round driver/vehicle notification after successful i’way return.
- Driver/vehicle change notification after a subsequent confirmed i’way return.
- Notification history/snapshots.
- Manual resend controls in order details.
- Exception surfacing for failed/missing/ambiguous cases.

### 3.2 Explicitly out of scope for V1

- General-purpose AI customer-service agent.
- Free-form AI automatic replies to arbitrary customer questions.
- AI airport recognition.
- Automatic modification of i’way/source order data based on customer replies.
- Map/location links for airport meeting points.
- Mandatory customer-confirmation status on the main order dashboard.
- Complex AI auto-reply settings UI.
- Automatic repeated chasing of customers who do not reply.

The architecture should leave room for future scenario-based automatic replies, but V1 should not implement them.

## 4. Regional applicability

Customer WhatsApp automation must be configurable per operating region under Settings / Rules.

Example current configuration:

- Bangkok — Customer WhatsApp notifications: ON
- Koh Samui — Customer WhatsApp notifications: OFF

When OFF, orders in that region must not participate in:

- T-24h automatic first contact;
- manual batch customer-contact eligibility;
- automatic second-round driver notifications;
- customer-notification-specific exception generation.

Do not hard-code Bangkok/Samui behavior. Future regions must be able to enable the feature without code changes.

## 5. End-to-end workflow

```text
Order imported
  ↓
Operator reviews order as part of normal work
  ↓
First customer contact
  ├─ Manual: select orders → Batch contact customers → preview → send
  └─ Automatic fallback: T-24h if first contact has not already been sent
  ↓
Customer receives order confirmation request + luggage question
  └─ Pickup order: airport guide also sent when available
  ↓
Customer replies
  ├─ Confirms order → record confirmation fact
  ├─ Gives luggage → structure and save luggage data → capacity/risk check
  ├─ Reports order discrepancy/change → exception → notify operator
  └─ Other/unclear → human-review exception; no automatic reply
  ↓
Fleet assigned → driver/vehicle information received and reviewed
  ↓
Operator formally returns driver/vehicle information to i’way
  ↓
Immediate automatic second-round WhatsApp with driver/vehicle information
  ↓
If driver/vehicle later changes:
new data alone does nothing → subsequent formal i’way return → compare with last sent snapshot → send update only if changed
```

## 6. First customer contact

### 6.1 Trigger model

There is no separate “Confirm order” button.

#### Manual path

At any time after reviewing orders, the operator may:

`Select orders on dashboard → Batch contact customers → Preview → Send`

Sending the message itself is sufficient evidence that the operator reviewed the order.

#### Automatic fallback

At **T-24h before service time**, if an eligible order has not had its first customer contact sent, the system automatically sends it without requiring the operator to be online.

If an eligible order enters the system already within 24 hours of service, the system should send as soon as practical once the order has enough information to send the core message.

There is no urgent/very-urgent classification and no customer contact-hours window.

### 6.2 First-contact content

Use stable templates rather than free-form AI generation.

#### Common content

1. **Identity / introduction**
   - Explain who is contacting the passenger and why.
   - Identify the company as the local transportation provider handling the passenger’s i’way transfer.

2. **Order information for confirmation**
   Include relevant customer-facing fields such as:
   - service date;
   - pickup time;
   - pickup location;
   - destination;
   - passenger count;
   - flight number when applicable.

   Do not include the planned vehicle type in the first message when the actual vehicle assignment may still change.

3. **Luggage question**
   Ask for luggage quantity with particular emphasis on large suitcases, rather than asking only for an undifferentiated total number of bags.

#### Airport pickup addition

For a recognized airport pickup, append/send the matched airport pickup guide text and guide images.

#### Non-pickup / airport drop-off

Do not send an airport guide.

### 6.3 Missing airport guide must not block contact

Airport guidance is an enhancement, not a prerequisite for first contact.

If the airport is recognized but no active guide is available:

- still send introduction + order confirmation + luggage question;
- do not send airport guide content;
- create an operator exception such as `Airport guide not sent: guide missing for BKK`;
- allow the guide to be manually sent later.

## 7. Manual batch contact UI

The active order dashboard should support a batch action:

**Batch contact customers**

The preview should summarize, rather than force the operator to open every order individually.

Example:

- 8 selected
- 6 ready to send
- 1 missing valid customer phone/WhatsApp contact
- 1 airport pickup with guide issue

Normal eligible orders are selected by default. Orders that cannot send the core message are excluded by default and show the reason.

Each order can be expanded to preview its generated message. The operator may make a one-off edit for that send only. A one-off edit must not mutate the global template or airport-guide library.

Global templates should remain separately maintainable (for example first contact, driver information, driver-information update).

## 8. Airport guide library

### 8.1 Guide fields

Each airport guide should contain at minimum:

- airport display name;
- IATA code when known;
- recognition aliases/keywords;
- optional terminal discriminator;
- guide text;
- multiple directly uploaded guide images;
- active/inactive state.

Do not include:

- pickup/drop-off direction field (the library is for pickup guides only);
- map-location URL in V1.

Terminal support should exist in the data model but may remain unused until a real operational need appears.

### 8.2 Version/history behavior

The system should allow an old guide to be deactivated and a new guide activated rather than requiring historical notification records to depend on the current guide content.

Notification history must preserve what was actually sent at the time.

## 9. Airport recognition

Airport recognition must be deterministic. **Do not call AI for airport recognition.**

### 9.1 Recognition order

1. IATA airport code match.
2. Airport aliases / keywords.
3. Address rules / conservative fuzzy matching.

For an order, determine whether the airport is the pickup location or drop-off location:

- airport at pickup → airport pickup → guide eligible;
- airport at drop-off → airport drop-off → no guide;
- no recognized airport at pickup → treat as non-airport-pickup unless the address clearly appears airport-like but cannot be resolved.

### 9.2 Unresolved airport-like address

If the pickup address clearly contains airport indicators such as `Airport`, `International Airport`, `Terminal`, etc., but the system cannot identify the airport:

- do not guess;
- do not use AI;
- surface an exception for the operator;
- still send the core first-contact content when otherwise possible, without a guide.

### 9.3 Recognized airport but missing guide

This is a distinct condition from recognition failure.

Example:

- system recognizes `Phuket International Airport (HKT)`;
- no HKT guide exists.

Surface `Missing airport guide` rather than `Airport recognition failed`.

### 9.4 Learning aliases

When the operator manually resolves an unrecognized airport address, the UI may offer a lightweight action to add that address/alias pattern to the selected airport’s deterministic recognition rules for future orders.

## 10. Customer reply understanding

V1 principle:

> **AI may read; AI should not freely speak.**

The system should first use simple deterministic parsing where reliable, and use AI when the customer’s natural-language reply is difficult to interpret.

### 10.1 Confirmation

Simple replies such as `Yes`, `Correct`, `OK` may be recorded as customer confirmation without an AI call.

A single message may contain multiple facts. Example:

`Yes, everything is correct. We have 3 large suitcases.`

The system may record both:

- order confirmed;
- 3 large suitcases.

### 10.2 Luggage extraction

Preserve the raw customer message and extract structured luggage data where possible, such as:

- large suitcases;
- carry-on/small luggage;
- stroller;
- other relevant bulky items.

Write the structured result into order luggage fields while retaining the original customer reply for audit/context.

Use AI only when deterministic parsing is insufficient.

### 10.3 Order discrepancy / requested change

If the customer indicates that order information is wrong or changed — for example date, time, flight number, passenger count, pickup address, destination — the system must:

- preserve the original reply;
- identify the likely discrepancy;
- create a high-visibility operator exception;
- **never automatically modify the source/i’way order fields**.

Example presentation:

`Order: TG410 / 14:30`  
`Customer: “My flight is TG402, arriving at 15:10.”`  
`Detected: possible flight number and arrival-time change`

Human intervention is required.

### 10.4 Other / unclear replies

If the reply cannot be safely classified:

- do not generate an automatic customer reply;
- preserve the raw message;
- create `Customer reply needs review` for the operator.

V1 does not implement general AI customer service.

## 11. Luggage risk and vehicle-capacity checks

Luggage handling is not only data extraction; it must support operational risk detection.

### 11.1 Two risk layers

1. **Inherently unusual luggage load**
   - Example: 6 passengers with 13 large suitcases.
   - May be flagged even before a vehicle is assigned.

2. **Assigned vehicle capacity risk**
   - Compare passenger/luggage information with the assigned vehicle’s configured capacity guidance.

### 11.2 Capacity rules

Vehicle capacity should be based on maintainable business rules rather than AI guesses.

A vehicle type may eventually define guidance such as:

- recommended/max passenger capacity;
- normal large-luggage range;
- warning threshold;
- clearly unsuitable threshold where useful.

The exact initial capacities should be configured from real fleet knowledge rather than invented during implementation.

### 11.3 Operator behavior

Capacity/luggage warnings should **warn, not block** dispatch or other legitimate operator actions.

Example:

`⚠ Luggage may exceed vehicle capacity. Please verify vehicle arrangement.`

## 12. Second-round driver/vehicle notification

### 12.1 Trigger

Do not add a separate “Confirm driver” button.

**Successful formal i’way return is the confirmation event.**

After driver/vehicle information is successfully returned to i’way, immediately send the customer the confirmed driver/vehicle information.

There is no additional T-3h/T-6h delay.

### 12.2 Content

Use a stable template containing the confirmed information, typically:

- driver name;
- driver phone;
- vehicle model/type;
- license plate.

Driver/vehicle photos are not required for V1.

Do not resend the airport guide as part of this message.

### 12.3 Incomplete data

If required driver/vehicle fields are incomplete, do not send a partial automatic driver-information message. Surface an exception instead.

### 12.4 Driver/vehicle changes

Changing driver/vehicle data in the database alone must not notify the customer.

Flow:

`new driver data entered → operator reviews → formal i’way return → compare with last customer notification snapshot`

If the newly confirmed driver/vehicle information differs from what was previously sent, automatically send a **driver information update** message telling the customer to use the latest information.

If it is identical, do not send a duplicate message.

## 13. Notification history (“snapshot”)

A notification snapshot is **structured/textual database data, not an image or screenshot**.

For each customer notification, preserve enough information to know exactly what was sent at that moment, for example:

- order ID;
- notification type;
- recipient/contact;
- rendered message text;
- relevant structured values (driver name, phone, vehicle, plate, etc.);
- referenced/sent airport guide content or guide version where relevant;
- sent timestamp;
- provider delivery/send result;
- retry/error information where applicable.

This enables reliable duplicate/change detection and audit history without significant storage overhead.

## 14. Sending failures and retries

- Missing/invalid customer contact must not block the order itself; surface an exception.
- Temporary WhatsApp/API failures may receive a limited number of automatic retries.
- Never retry indefinitely.
- Prevent duplicate sends if a prior request succeeded but the application response was uncertain; implementation should use appropriate idempotency/deduplication mechanisms.
- After retries are exhausted, surface an operator exception.

## 15. Customer non-response

V1 does not automatically chase customers who do not reply.

A successfully sent first contact completes the system’s outbound first-contact obligation. The order detail may show that no reply has been received, and the operator may manually contact/resend if desired.

## 16. Manual controls in order details

Order details should include a lightweight customer communication section with relevant history and manual fallback actions, including as applicable:

- view first-contact send/history;
- view customer raw replies and interpreted luggage/confirmation facts;
- view exceptions;
- manually resend first-contact message;
- manually send/re-send airport guide;
- view driver-information send/history;
- manually resend driver information.

Do not add customer-confirmation information as a permanent new column/status on the main dashboard in V1.

## 17. Exceptions surfaced to operator

Only actionable exceptions should compete for attention. Examples:

- invalid/missing customer WhatsApp contact;
- first-contact send failed after retries;
- airport-like pickup address cannot be identified;
- recognized airport has no active guide;
- airport guide failed to send;
- customer reports order information mismatch/change;
- customer reply requires manual review;
- luggage quantity is clearly unusual;
- luggage/passenger load may exceed assigned vehicle capacity;
- driver notification cannot be sent because confirmed driver data is incomplete;
- driver notification failed after retries.

Exceptions should inform and route the operator; they should not unnecessarily block unrelated order operations.

## 18. Data-model direction

Engineering may adapt names to the existing Prisma conventions, but the conceptual model should include:

### AirportGuide

- airport identity / IATA
- aliases/recognition rules
- optional terminal
- guide text
- uploaded image references
- active/inactive/version information

### CustomerNotification

Use an independent notification record rather than placing one notification state directly on Order, because one order may have multiple communications:

- first contact;
- airport guide/manual supplemental guide;
- driver information;
- driver-information update;
- manual resend/future notification types.

Store rendered notification snapshots/history.

### Customer reply / communication history

Preserve raw inbound content and interpreted facts. The exact table split may follow existing architecture, but raw inbound data must remain auditable.

### Order luggage data

Support structured luggage facts rather than only free text. Exact fields should be chosen during engineering design based on existing Order schema and migration cost.

### Regional customer-notification configuration

Persist an enable/disable setting per operating region; do not encode city names in application logic.

## 19. WhatsApp integration boundary

The product workflow should be designed independently from a specific WhatsApp transport implementation where practical.

V1 requires a transport capable of:

- outbound text;
- outbound guide images;
- receiving customer replies;
- associating inbound messages with the correct order/customer conversation;
- reporting send failures/results sufficiently for retries and exceptions.

Before implementation, engineering must verify the actual WhatsApp Business/API integration method, authentication requirements, template restrictions, conversation/session rules, costs, webhook requirements, and media-upload behavior. Do not invent these details in application code.

## 20. Safety / authority boundaries

The system may automatically:

- send approved stable templates under the defined triggers;
- attach matched airport guides;
- parse and store luggage information;
- record simple customer confirmation;
- flag likely discrepancies and risks;
- send confirmed driver information after formal i’way return;
- send driver updates after a subsequent confirmed return when data changed.

The system must not automatically:

- modify source/i’way order details based on customer claims;
- decide arbitrary customer-service responses;
- guess an airport using AI;
- invent vehicle capacity;
- repeatedly message an unresponsive customer without a defined future policy.

## 21. Acceptance criteria

V1 is acceptable when all of the following are true:

1. Customer notification can be enabled/disabled per operating region.
2. Eligible orders can be manually selected from the dashboard and batch first-contact messages previewed/sent.
3. Eligible unsent orders automatically receive first contact at T-24h, including orders imported inside the 24-hour window.
4. Pickup orders deterministically match airport guides when possible; drop-off/non-pickup orders do not receive guides.
5. Missing guide content does not prevent the core first-contact message from sending.
6. Airport recognition never uses AI.
7. Airport guide text and multiple uploaded images can be maintained in a library.
8. Customer confirmation and luggage replies can be understood and recorded; AI is used only where natural-language interpretation needs it.
9. Customer-reported order discrepancies never automatically mutate source order data and are surfaced to the operator.
10. Unclear customer replies do not receive free-form automatic AI responses.
11. Structured luggage data is checked for unusual quantity and assigned-vehicle capacity risk using maintainable business rules.
12. Successful formal i’way return immediately triggers the driver/vehicle customer notification when required fields are complete.
13. A later formal i’way return sends an update only when confirmed driver/vehicle information differs from the last sent snapshot.
14. Notification history preserves what was actually sent.
15. Send failures are retried only within a bounded policy and then surfaced as exceptions.
16. The system does not automatically chase customers who do not reply.
17. Order details provide manual resend/history controls.
18. Main dashboard remains operationally lean; no permanent customer-confirmation status column is added.

## 22. Implementation planning notes

Before coding, engineering should inspect and reuse existing order, region, driver/vehicle, i’way return, activity/audit, and background-task infrastructure rather than building parallel workflow systems.

Recommended implementation sequence:

1. Confirm WhatsApp integration constraints and inbound/outbound transport architecture.
2. Finalize data model/migrations for AirportGuide, notifications/replies, regional setting, luggage facts, and capacity guidance.
3. Build Airport Guide library and image upload/storage.
4. Implement deterministic airport recognition/matching.
5. Add regional feature toggle.
6. Add manual batch first-contact preview/send.
7. Add T-24h reliable scheduled sending and bounded retry/idempotency.
8. Add inbound reply association, deterministic parsing, and AI fallback for ambiguous reply understanding.
9. Add luggage risk/capacity rules and exceptions.
10. Connect successful i’way return to second-round customer notification and snapshot comparison.
11. Add order-detail communication history/manual fallback controls.
12. Add focused desktop/mobile regression coverage.

This implementation sequence is guidance, not permission to expand V1 scope. Prefer reuse of existing modules and minimal changes outside the Phase 2 workflow.