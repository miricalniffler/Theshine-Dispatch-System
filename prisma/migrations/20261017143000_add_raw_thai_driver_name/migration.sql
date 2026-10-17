-- Additive only: preserve the spelling seen in a Thai fleet screenshot while
-- the corresponding English transliteration is used for i'way output.
ALTER TABLE "DriverDetail"
  ADD COLUMN "rawThaiDriverName" TEXT;
