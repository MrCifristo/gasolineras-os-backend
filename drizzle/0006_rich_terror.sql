ALTER TABLE "vehiculos" ALTER COLUMN "bloqueado" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "configuracion_sistema" ALTER COLUMN "bloqueado_por" SET DATA TYPE varchar(255);