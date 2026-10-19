# Production AI and archive fix migration

Migration `20261019133000_add_vehicle_category_to_archives` only adds two nullable columns:

- `DriverDetail.confirmedVehicleCategory`
- `VehicleProfile.vehicleCategory`

It contains no data backfill, deletion, update of existing orders, table drop, or index rebuild. Existing driver and vehicle rows remain valid; the new values are populated only when an operator saves new or corrected fleet-reply data.

Before deployment, retain the existing logical Production backup. Application rollback can safely return to the previous code because the new columns are additive; do not delete the columns during an incident, so any newly saved audit data remains recoverable.
