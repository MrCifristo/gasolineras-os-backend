ALTER TABLE "movimientos_saldo" ALTER COLUMN "gasolinera_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "credito_bloqueado" boolean DEFAULT false NOT NULL;