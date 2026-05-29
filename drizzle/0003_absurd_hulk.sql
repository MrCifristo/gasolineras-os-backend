ALTER TABLE "vehiculos" ADD COLUMN "bloqueado" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "vehiculos" ADD COLUMN "limite_diario_monto" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "vehiculos" ADD COLUMN "dias_permitidos" text[];--> statement-breakpoint
ALTER TABLE "vehiculos" ADD COLUMN "hora_inicio" varchar(5);--> statement-breakpoint
ALTER TABLE "vehiculos" ADD COLUMN "hora_fin" varchar(5);