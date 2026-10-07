UPDATE "usuarios" SET "telefono" = NULL WHERE "telefono" IS NOT NULL AND btrim("telefono") = '';--> statement-breakpoint
UPDATE "usuarios" SET "email" = NULL WHERE "email" IS NOT NULL AND btrim("email") = '';
