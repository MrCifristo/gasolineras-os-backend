CREATE TABLE "turnos_gasolinera" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gasolinera_id" uuid NOT NULL,
	"turno" varchar NOT NULL,
	"hora_inicio" time NOT NULL,
	"hora_fin" time NOT NULL,
	"recordatorio_activo" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "recordatorios_turno" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gasolinera_id" uuid NOT NULL,
	"turno" varchar NOT NULL,
	"fecha" date NOT NULL,
	"enviado_en" timestamp with time zone DEFAULT now(),
	"correos_enviados" integer DEFAULT 0 NOT NULL,
	"push_enviados" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suscripciones_push" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" varchar NOT NULL,
	"auth" varchar NOT NULL,
	"user_agent" varchar,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "suscripciones_push_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
ALTER TABLE "turnos_gasolinera" ADD CONSTRAINT "turnos_gasolinera_gasolinera_id_gasolineras_id_fk" FOREIGN KEY ("gasolinera_id") REFERENCES "public"."gasolineras"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recordatorios_turno" ADD CONSTRAINT "recordatorios_turno_gasolinera_id_gasolineras_id_fk" FOREIGN KEY ("gasolinera_id") REFERENCES "public"."gasolineras"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suscripciones_push" ADD CONSTRAINT "suscripciones_push_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "turnos_gasolinera_gasolinera_turno_idx" ON "turnos_gasolinera" USING btree ("gasolinera_id","turno");--> statement-breakpoint
CREATE UNIQUE INDEX "recordatorios_turno_unico_idx" ON "recordatorios_turno" USING btree ("gasolinera_id","turno","fecha");--> statement-breakpoint
-- constraint ya existente desde 0001
--> statement-breakpoint
-- Turnos por defecto para las gasolineras existentes. Las nuevas los reciben
-- en GasolinerasService.create. Mismo horario que TURNOS_POR_DEFECTO.
INSERT INTO "turnos_gasolinera" ("gasolinera_id", "turno", "hora_inicio", "hora_fin")
SELECT "id", 'manana', '06:00'::time, '14:00'::time FROM "gasolineras"
UNION ALL
SELECT "id", 'tarde', '14:00'::time, '22:00'::time FROM "gasolineras"
ON CONFLICT DO NOTHING;
