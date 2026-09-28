ALTER TABLE "User" ADD CONSTRAINT "money_nonnegative" CHECK (money >= 0);
ALTER TABLE "Resource" ADD CONSTRAINT "resource_nonnegative" CHECK (amount >= 0 AND capacity >= 0);
ALTER TABLE "Building" ADD CONSTRAINT "building_bounds" CHECK (x >= 0 AND x < 64 AND y >= 0 AND y < 64 AND progress >= 0 AND progress <= 1);
ALTER TABLE "Territory" ADD CONSTRAINT "territory_area" CHECK ("areaKm2" > 0 AND length(grid) = 4096);
ALTER TABLE "Purchase" ADD CONSTRAINT "purchase_positive" CHECK ("amountCents" > 0);
ALTER TABLE "Offer" ADD CONSTRAINT "offer_positive" CHECK ("amountCents" > 0);
ALTER TABLE "MarketplaceListing" ADD CONSTRAINT "listing_positive" CHECK ("priceCents" > 0);
