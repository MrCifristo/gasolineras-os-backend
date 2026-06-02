CREATE TABLE "configuracion_sistema" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sistema_bloqueado" boolean DEFAULT false NOT NULL,
	"bloqueado_por" varchar,
	"bloqueado_en" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gasolineras" ADD COLUMN "bloqueado" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "bloqueado" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "limite_monto_dia" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "limite_monto_semana" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "limite_monto_mes" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "plantilla_monto_transaccion" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "plantilla_monto_dia" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "plantilla_monto_semana" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "plantilla_monto_mes" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "plantilla_volumen_transaccion" numeric(10, 3);--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "plantilla_volumen_dia" numeric(10, 3);--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "plantilla_volumen_semana" numeric(10, 3);--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "plantilla_volumen_mes" numeric(10, 3);--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "plantilla_trans_dia" integer;--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "plantilla_trans_semana" integer;--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "plantilla_trans_mes" integer;--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "plantilla_productos_permitidos" text[];