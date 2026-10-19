-- Additive-only: retain the fleet-provided vehicle class separately from the
-- exact vehicle model. Existing driver, vehicle and order records are untouched.
ALTER TABLE "DriverDetail" ADD COLUMN "confirmedVehicleCategory" TEXT;
ALTER TABLE "VehicleProfile" ADD COLUMN "vehicleCategory" TEXT;
