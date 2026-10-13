CREATE TABLE "tipos_vehiculo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" varchar NOT NULL,
	"activo" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tipos_vehiculo_nombre_unico" ON "tipos_vehiculo" USING btree (lower("nombre")) WHERE "tipos_vehiculo"."activo";--> statement-breakpoint
-- Siembra: los tipos que el formulario tenía fijos en el código, Motocicleta,
-- y cualquier otro que ya tengan los vehículos registrados.
INSERT INTO "tipos_vehiculo" ("nombre")
SELECT DISTINCT ON (lower(nombre)) nombre
FROM (
  SELECT unnest(ARRAY['Camión Cisterna', 'Camión Repartidor', 'Camión de Carga', 'Trailer', 'Pick-up', 'Panel', 'Motocicleta']) AS nombre, 0 AS prioridad
  UNION ALL
  SELECT btrim("tipo_vehiculo"), 1 FROM "vehiculos"
  WHERE "tipo_vehiculo" IS NOT NULL AND btrim("tipo_vehiculo") <> ''
) AS t
ORDER BY lower(nombre), prioridad;
