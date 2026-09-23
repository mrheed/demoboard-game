ALTER TABLE "transactions" ADD COLUMN "tx_event_index" integer;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "funds_reserved" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "transactions" SET "status" = 'failed', "note" = concat_ws(' · ', "note", 'Cancelled during launch hardening; submit a new withdrawal.'), "updated_at" = now() WHERE "type" = 'withdraw' AND "status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_deposit_chain_event_uidx" ON "transactions" USING btree ("chain","tx_hash","tx_event_index") WHERE "type" = 'deposit' AND "tx_hash" IS NOT NULL AND "tx_event_index" IS NOT NULL;--> statement-breakpoint
DELETE FROM "play_documents" WHERE "key" LIKE 'wallet-login-%';
