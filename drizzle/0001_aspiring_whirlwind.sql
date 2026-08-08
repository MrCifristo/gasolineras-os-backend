CREATE TABLE "operarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gasolinera_id" uuid NOT NULL,
	"nombre" varchar NOT NULL,
	"codigo" varchar,
	"activo" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
-- Rename in place (preserva filas existentes) en vez de recrear el enum, que
-- perdería cualquier fila con el valor 'operario'. Añadir 'jefe_pista' es
-- válido en la misma transacción en PG12+ mientras no se USE el valor aquí.
ALTER TYPE "public"."rol" RENAME VALUE 'operario' TO 'supervisor';--> statement-breakpoint
ALTER TYPE "public"."rol" ADD VALUE 'jefe_pista';--> statement-breakpoint
ALTER TABLE "usuarios" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "telefono" varchar;--> statement-breakpoint
ALTER TABLE "despachos" ADD COLUMN "operario_id" uuid;--> statement-breakpoint
ALTER TABLE "operarios" ADD CONSTRAINT "operarios_gasolinera_id_gasolineras_id_fk" FOREIGN KEY ("gasolinera_id") REFERENCES "public"."gasolineras"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "despachos" ADD CONSTRAINT "despachos_operario_id_operarios_id_fk" FOREIGN KEY ("operario_id") REFERENCES "public"."operarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_telefono_unique" UNIQUE("telefono");--> statement-breakpoint
-- Regla de negocio: todo usuario necesita al menos un identificador de acceso.
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_email_o_telefono_chk" CHECK ("email" IS NOT NULL OR "telefono" IS NOT NULL);
