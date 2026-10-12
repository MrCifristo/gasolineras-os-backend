-- Correlativo propio del cliente: sus vales numerados 1, 2, 3… sin importar la
-- estación ni la serie. Se agrega nullable, se rellena el histórico y recién
-- entonces pasa a NOT NULL; con la columna NOT NULL directa el ALTER fallaría
-- en cualquier base que ya tenga despachos.
ALTER TABLE "despachos" ADD COLUMN "correlativo_cliente" integer;--> statement-breakpoint
-- Backfill: por cliente, en el orden en que se despachó. El id desempata dos
-- vales del mismo instante para que el orden sea determinista.
UPDATE "despachos" d
SET "correlativo_cliente" = n."correlativo"
FROM (
	SELECT "id", ROW_NUMBER() OVER (PARTITION BY "cliente_id" ORDER BY "despachado_at", "id") AS "correlativo"
	FROM "despachos"
) n
WHERE n."id" = d."id";--> statement-breakpoint
ALTER TABLE "despachos" ALTER COLUMN "correlativo_cliente" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "despachos_cliente_correlativo_idx" ON "despachos" USING btree ("cliente_id","correlativo_cliente");
