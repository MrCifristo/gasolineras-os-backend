CREATE TYPE "public"."renglon_despacho" AS ENUM('vehiculo', 'caneca', 'tonel');--> statement-breakpoint
CREATE TABLE "despacho_detalles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"despacho_id" uuid NOT NULL,
	"renglon" "renglon_despacho" NOT NULL,
	"tipo_combustible" varchar NOT NULL,
	"precio_id" uuid NOT NULL,
	"monto" numeric(10, 3) NOT NULL,
	"galones" numeric(10, 3) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "despachos" ALTER COLUMN "vehiculo_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "despachos" ALTER COLUMN "piloto_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "despachos" ALTER COLUMN "precio_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "despacho_detalles" ADD CONSTRAINT "despacho_detalles_despacho_id_despachos_id_fk" FOREIGN KEY ("despacho_id") REFERENCES "public"."despachos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "despacho_detalles" ADD CONSTRAINT "despacho_detalles_precio_id_precios_combustible_id_fk" FOREIGN KEY ("precio_id") REFERENCES "public"."precios_combustible"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "despacho_detalles_despacho_idx" ON "despacho_detalles" USING btree ("despacho_id");--> statement-breakpoint
CREATE INDEX "despacho_detalles_renglon_idx" ON "despacho_detalles" USING btree ("renglon");--> statement-breakpoint
-- Backfill: un renglón 'vehiculo' por cada despacho ya existente.
--
-- No es opcional. Los límites por vehículo pasan a agregar sobre
-- despacho_detalles; sin estas filas el histórico contaría como cero y un
-- vehículo con su cupo mensual ya gastado volvería a despachar sin bloqueo.
--
-- Los despachos anteriores son todos de un solo renglón al vehículo, así que
-- monto_total y galones del header son exactamente los del renglón.
INSERT INTO "despacho_detalles" ("despacho_id", "renglon", "tipo_combustible", "precio_id", "monto", "galones")
SELECT d."id", 'vehiculo', p."tipo_combustible", d."precio_id", d."monto_total", d."galones"
FROM "despachos" d
JOIN "precios_combustible" p ON p."id" = d."precio_id"
WHERE d."precio_id" IS NOT NULL;
