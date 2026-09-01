# Theshine Dispatch System — Workflow Refactor v1.0

**Document type:** Product Requirements Document (PRD) + Engineering Specification  
**Status:** Approved for implementation  
**Repository:** `miricalniffler/Theshine-Dispatch-System`  
**Target branch:** `codex/reliability-sync-performance`  
**Scope:** Operational workflow simplification  
**Out of scope:** Airport Guide Library, CustomerNotification, WhatsApp Business API automation

---

## 1. Background

The current dispatch platform exposes the internal order state machine too prominently. Operators frequently need to perform additional clicks only to keep system status synchronized with work that has already happened in WeChat, WhatsApp, or i’way.

Examples:

- After generating/sending a fleet dispatch message, the operator is asked to confirm “I have sent it to the fleet”.
- Fleet reply processing and i’way return are presented as separate modules although they form one continuous operational step.
- The active order dashboard repeats workflow state through status counters, status filters, status columns and “next action” controls.
- Internal status values are useful for backend logic and historical audit, but are not useful enough to justify dominating the active workspace.

This refactor changes the UI model from **state-driven operation** to **action-driven operation**.

### Core product principle

> Real operational actions should represent progress. Operators should not perform extra actions solely to maintain application state.

The backend state machine remains available for compatibility, automation, audit and historical querying.

---

## 2. Goals

### 2.1 Primary goals

- Reduce unnecessary clicks in daily dispatch operations.
- Reduce navigation between pages.
- Merge fleet-reply processing and i’way-return generation into one continuous workflow.
- Make the active order dashboard reflect actionable business information instead of internal workflow states.
- Preserve existing backend compatibility and rollback capability.
- Maintain desktop and mobile usability.

### 2.2 Success criteria

A normal fleet workflow should become:

`Orders → Generate fleet dispatch → Fleet reply → Extract/confirm driver details → Generate i’way return → Copy`

No separate status-maintenance action should be required between these steps.

---

## 3. Non-goals

This release MUST NOT:

- redesign order import;
- modify Feishu synchronization behavior;
- remove `Order.status`;
- remove `DispatchBatch`, `IwayReturnBatch`, `ActivityLog`, or related APIs;
- introduce destructive Prisma migrations;
- redesign the AI extraction model;
- implement WhatsApp Business API;
- implement AirportGuide database models;
- implement CustomerNotification;
- implement passenger airport-guide notifications;
- remove legacy routes/APIs solely because the new UI no longer exposes them.

---

## 4. Existing architecture relevant to this refactor

Primary frontend surfaces:

- `src/features/orders/order-dashboard.tsx`
- `src/features/dispatch/DispatchPreviewDialog.tsx`
- `src/features/fleet-replies/fleet-reply-workspace.tsx`
- `src/features/iway/driver-workspace.tsx`
- `src/features/orders/OrderDetailDrawer.tsx`
- `src/app/orders/[id]/page.tsx`
- `src/components/AppNavigation.tsx`
- `src/features/orders/history-orders.tsx`

Relevant backend concepts:

- `Order.status`
- `DriverDetail`
- `DispatchBatch`
- `IwayReturnBatch`
- `ActivityLog`
- fleet reply / AI extraction records

The existing `/driver-details` route already renders `FleetReplyWorkspace`. That workspace can save confirmed driver information and invoke the existing i’way preview flow. This implementation should be consolidated rather than replaced.

---

## 5. Target information architecture

### 5.1 Primary navigation

Daily operational navigation:

1. **订单**
2. **车队回传**
3. **机场指引库** — reserved for next phase; do not expose a dead link in this release
4. **车队管理**
5. **历史订单**

Low-frequency configuration:

- **设置 / 规则**

Remove **i’way 回传** from primary navigation.

### 5.2 Mobile navigation

Primary bottom navigation:

- **订单**
- **车队回传**
- **更多**

“更多” contains:

- 车队管理
- 历史订单
- 设置 / 规则

Airport Guide Library will be added in a later release.

---

## 6. Target operational workflows

### 6.1 Fleet dispatch

**Current**

`Select orders → Generate preview → Copy/open WhatsApp → Confirm "sent to fleet"`

**Target**

`Select orders → Generate preview → Copy/open WhatsApp → Done`

Copy/generation activity may still be logged. Explicit send confirmation is not required.

### 6.2 Fleet reply + i’way return

**Target**

`Paste fleet reply/images → AI extraction → Review/correct → Complete orders selected automatically → Generate i’way text → Copy`

This must occur on the same `/driver-details` workspace.

### 6.3 Historical audit

Historical orders remain state-aware.

`Order.status` remains visible/filterable in historical records because it has audit/query value.

---

## 7. Feature specification

### 7.1 Order Dashboard Simplification

**Component:** `order-dashboard.tsx`

#### Remove from active desktop table

- Status column
- Next-action column
- Per-row state-driven “next step” UI

#### Target table

| Column | Content |
|---|---|
| Select | batch selection |
| Pickup time | service date/time |
| Order | platform order number |
| Passenger / Route | passenger identity and route |
| Vehicle / Fleet | platform vehicle and assigned fleet |
| Driver / Vehicle | confirmed operational information |

#### Driver / Vehicle presentation

No driver data:

`等待车队回复` or `—`

Partial driver data:

`⚠ 缺车牌`

or another explicit missing-field message.

Complete data:

`Piya`  
`Toyota Commuter · นง3003`

Do not introduce a new manual workflow state to support this cell.

---

## 8. Dashboard todo summary

Replace state-oriented dashboard emphasis with operational todos.

Target concepts:

- 等待车队回复
- 司机资料需补充
- 可回传 i’way
- 异常订单

Passenger notification todo is NOT part of this release.

Todo cards may be clickable if this can be implemented without significant additional API or state complexity.

Status filtering should no longer be a primary control on the active order workspace.

Backend status query support must remain available.

---

## 9. Dispatch Preview

**Component:** `DispatchPreviewDialog.tsx`

### Remove from primary workflow

`我已发送给车队`

### Preserve

- dispatch preview API;
- clipboard behavior and fallback;
- WhatsApp share/open behavior;
- copy logging;
- DispatchBatch records;
- existing confirm endpoint for backward compatibility.

The UI must not require `/api/dispatch-batches/confirm` to complete normal dispatch usage.

### Interaction rule

Reversible/non-destructive actions should not trigger confirmation dialogs.

---

## 10. Fleet Reply Workspace

**Primary route:** `/driver-details`  
**Primary component:** `FleetReplyWorkspace`

This becomes the canonical fleet-response operational workspace.

### Section A — Fleet source

Inputs:

- raw fleet reply text;
- pasted/uploaded vehicle images;
- service date;
- fleet profile/rule;
- analyze action.

### Section B — Extraction result

For each matched order display:

- order number;
- driver name;
- driver phone;
- vehicle model;
- license plate;
- completeness / missing fields.

#### Selection behavior

Complete records:

- selected by default for i’way return.

Incomplete records:

- not selected by default;
- explicit missing-field reason displayed.

Operators may manually deselect a complete record.

After correction, an incomplete record can become eligible for selection.

### Section C — i’way return

Within the same page:

- generate standard i’way text;
- preview generated text;
- copy all.

Do not require navigation to `/iway-return`.

Existing `saveAndGenerate()` and i’way batch APIs should be reused where practical.

---

## 11. Legacy i’way workspace

**Route:** `/iway-return`

### Deprecation policy

- Remove from primary navigation.
- Remove from normal order-workflow entry points.
- Do not delete route/API in this release.
- Preserve compatibility and rollback capability.

A future release may redirect `/iway-return` to `/driver-details` after the consolidated workflow has been validated in production.

---

## 12. i’way confirmation behavior

The existing “sent/returned” confirmation must not block the workflow.

If retained in the new workspace, expose it only as a low-priority optional action:

`标记为已回传`

Requirements:

- not a primary CTA;
- no mandatory confirmation before leaving the page;
- does not block future operations;
- may continue using the existing confirm API.

---

## 13. Order Detail

### Full order page

Remove prominent:

`当前状态：XXX`

Internal state remains available in backend data.

### Activity history

Preserve activity records but visually downgrade them.

Default state:

`查看操作记录 ›`

Expand on user request.

### Future extension point

The order detail architecture should leave room for a future **客人通知** section, but this release must not implement passenger notification functionality.

---

## 14. History Orders

Historical orders intentionally retain workflow state.

Preserve:

- status column;
- status filter;
- historical lookup behavior.

The active dashboard and historical archive have different purposes:

- Active dashboard = operational execution.
- History = audit and lookup.

Do not apply active-dashboard “state hiding” blindly to historical records.

---

## 15. State-machine policy

### Keep

`Order.status` remains part of the backend source of truth.

Existing state transitions may continue to occur through current APIs.

### UX policy

The UI should infer/display concrete operational facts whenever possible instead of requiring the operator to manage abstract states.

Examples:

Prefer:

`缺车牌`

over:

`DRIVER_CONFIRMED = false`

Prefer:

`可生成 i’way 回传`

over:

`待回传平台`

### Compatibility

Do not remove status-based API query support.

---

## 16. API strategy

Prefer reuse over new endpoints.

Relevant existing API families include:

```text
POST /api/dispatch-batches/preview
POST /api/dispatch-batches/copy-log
POST /api/dispatch-batches/confirm

POST /api/fleet-replies
POST /api/fleet-replies/:id/analyze
POST /api/fleet-replies/:id/confirm

POST /api/iway-return-batches/preview
POST /api/iway-return-batches/copy-log
POST /api/iway-return-batches/confirm
```

### API compatibility policy

- Do not delete legacy endpoints in this release.
- New UI may stop calling some confirmation endpoints.
- Avoid new round trips when existing response data is sufficient.
- Checkbox/select operations should remain client-side until an actual persistence action is required.

---

## 17. Performance requirements

This refactor must not trade fewer clicks for slower interactions.

Requirements:

- No API request on each checkbox toggle.
- Avoid duplicate fetching of data already available in the current response.
- Preserve parallel save behavior for independent fleet-reply records.
- Avoid unnecessary full-page navigation.
- Avoid unnecessary confirmation dialogs.
- Keep clipboard fallback behavior for iOS Safari.
- Preserve image optimization/upload behavior in fleet reply processing.

---

## 18. Responsive requirements

Reference: `docs/mobile-regression-checklist.md`

Primary mobile acceptance sizes:

- 375 × 812
- 393 × 852
- 430 × 932
- Android Chrome 412 × 915

Desktop baseline:

- 1440 × 1000

Requirements:

- Active orders remain card-based on mobile.
- No new horizontal scrolling.
- Mobile cards must not expose redundant state badges or state-driven “next action” controls.
- Clipboard, WhatsApp, file selection, pasted images and bottom safe areas must remain usable.

---

## 19. Backward compatibility

The following are intentionally retained during this release:

- `Order.status`
- status-based order queries;
- `/iway-return`;
- i’way confirm API;
- dispatch confirm API;
- existing batch records;
- existing ActivityLog behavior where still applicable;
- historical status UI;
- existing rules system.

This release is a **UI/workflow deprecation**, not a destructive backend cleanup.

Legacy code cleanup should occur only after production validation.

---

## 20. Acceptance criteria

### AC-01 — Fleet dispatch

Given three valid same-date/same-fleet orders,

when the operator selects them and generates a dispatch,

then the operator can copy the text or open WhatsApp and close the dialog without clicking “我已发送给车队”.

### AC-02 — Active order table

The desktop active order table does not display:

- 状态
- 下一步

Driver/vehicle operational information is visible instead.

### AC-03 — Fleet extraction

Given a fleet reply that produces:

- two complete records;
- one record missing a license plate;

then:

- the two complete records are eligible and selected by default;
- the incomplete record is not selected;
- the UI explicitly identifies the missing license plate.

### AC-04 — i’way generation

The operator can generate and copy i’way return text without leaving `/driver-details`.

### AC-05 — Navigation

Primary navigation does not expose a separate i’way-return module.

### AC-06 — History

Historical orders still expose status and status filtering.

### AC-07 — Mobile

The active-order mobile interface contains no redundant state-driven “next action” workflow and does not require horizontal scrolling.

### AC-08 — Data safety

No destructive database migration is introduced.

---

## 21. Test requirements

Run applicable:

- TypeScript checks;
- production build;
- existing automated tests;
- mobile smoke tests where environment credentials are available.

Manual verification should cover:

- desktop active order list;
- mobile active order cards;
- batch dispatch preview;
- clipboard fallback;
- WhatsApp opening;
- fleet reply text paste;
- fleet reply image upload/paste;
- extraction correction;
- i’way generation;
- i’way copy;
- full order editing;
- historical order filtering.

Tests that encode deprecated UI behavior should be updated to the approved workflow rather than preserving obsolete controls solely to satisfy tests.

---

## 22. Implementation phases

### Phase 1 — Workflow simplification

Implement:

- active order dashboard simplification;
- dispatch confirmation removal from primary flow;
- fleet reply + i’way consolidation;
- primary navigation cleanup;
- order-detail status de-emphasis;
- mobile equivalents.

### Phase 2 — Passenger communication

Separate future specification:

- AirportGuide;
- airport/direction/terminal matching;
- guide text and images;
- optional Google Maps URL;
- CustomerNotification;
- WhatsApp passenger notification;
- notification history.

Phase 2 must not be mixed into Phase 1.

---

## 23. Definition of Done

The feature is done when:

- all Phase 1 acceptance criteria pass;
- build/type checks pass;
- relevant tests pass or failures are documented;
- mobile layouts have been verified;
- no destructive schema migration exists;
- unrelated pre-existing working-tree changes were not modified;
- implementation report lists changed files and compatibility decisions;
- operator can complete the main dispatch → fleet reply → i’way workflow with fewer explicit state-maintenance actions than before.

---

## 24. Implementation reporting template

After implementation, engineering/Codex should report:

### Changed files

- file path
- purpose of change

### Workflow changes

- removed operator actions
- merged navigation/page transitions

### Compatibility retained

- legacy routes
- legacy APIs
- backend state behavior

### Tests

- command
- result
- known failures

### Database

- migration introduced: Yes / No

### Working tree safety

- pre-existing unrelated files modified: Yes / No

### Manual QA

Provide exact routes and steps for product acceptance testing.

---

## 25. Product decision log

**Decision:** Active operations should not be driven by manual status maintenance.  
**Reason:** External communication occurs outside the platform, making explicit “I sent it” confirmations both burdensome and only weakly authoritative.

**Decision:** Fleet reply and i’way return are one operational workflow.  
**Reason:** Driver information extracted from the fleet reply is the direct input to the i’way return.

**Decision:** Historical orders retain status.  
**Reason:** Status remains useful for audit and retrospective lookup even when it is unnecessary during active execution.

**Decision:** Legacy APIs/routes remain during v1.  
**Reason:** Allows rollback and reduces regression risk.

**Decision:** Passenger notification is Phase 2.  
**Reason:** Workflow simplification should be validated independently before introducing a new communication subsystem.
