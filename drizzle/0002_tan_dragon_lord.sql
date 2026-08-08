CREATE TABLE "tokens_reset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expira_at" timestamp with time zone NOT NULL,
	"usado_at" timestamp with time zone,
	"creado_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tokens_reset_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "tokens_reset" ADD CONSTRAINT "tokens_reset_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tokens_reset_usuario_idx" ON "tokens_reset" USING btree ("usuario_id");