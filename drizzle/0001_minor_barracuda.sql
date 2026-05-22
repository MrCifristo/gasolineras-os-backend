CREATE TABLE "cuadres" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tipo" varchar NOT NULL,
	"gasolinera_id" uuid NOT NULL,
	"cliente_id" uuid,
	"fecha_desde" date NOT NULL,
	"fecha_hasta" date NOT NULL,
	"cuadrado_por" uuid NOT NULL,
	"notas" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "cuadres" ADD CONSTRAINT "cuadres_gasolinera_id_gasolineras_id_fk" FOREIGN KEY ("gasolinera_id") REFERENCES "public"."gasolineras"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cuadres" ADD CONSTRAINT "cuadres_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cuadres" ADD CONSTRAINT "cuadres_cuadrado_por_usuarios_id_fk" FOREIGN KEY ("cuadrado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
