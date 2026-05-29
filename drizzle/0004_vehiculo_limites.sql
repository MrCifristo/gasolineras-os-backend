ALTER TABLE "vehiculos" ADD COLUMN "limite_monto_transaccion" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "vehiculos" ADD COLUMN "limite_monto_dia" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "vehiculos" ADD COLUMN "limite_monto_semana" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "vehiculos" ADD COLUMN "limite_monto_mes" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "vehiculos" ADD COLUMN "limite_volumen_transaccion" numeric(10, 3);--> statement-breakpoint
ALTER TABLE "vehiculos" ADD COLUMN "limite_volumen_dia" numeric(10, 3);--> statement-breakpoint
ALTER TABLE "vehiculos" ADD COLUMN "limite_volumen_semana" numeric(10, 3);--> statement-breakpoint
ALTER TABLE "vehiculos" ADD COLUMN "limite_volumen_mes" numeric(10, 3);--> statement-breakpoint
ALTER TABLE "vehiculos" ADD COLUMN "limite_trans_dia" integer;--> statement-breakpoint
ALTER TABLE "vehiculos" ADD COLUMN "limite_trans_semana" integer;--> statement-breakpoint
ALTER TABLE "vehiculos" ADD COLUMN "limite_trans_mes" integer;--> statement-breakpoint
ALTER TABLE "vehiculos" ADD COLUMN "productos_permitidos" text[];--> statement-breakpoint
ALTER TABLE "vehiculos" DROP COLUMN "limite_diario_monto";
