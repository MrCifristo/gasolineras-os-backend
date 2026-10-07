-- Los identificadores en blanco pasan a NULL, salvo que la fila se quede sin
-- ninguno (CHECK usuarios_email_o_telefono_chk): esas filas, sin ningún
-- identificador válido, quedan para revisión manual.
UPDATE "usuarios" SET "telefono" = NULL WHERE "telefono" IS NOT NULL AND btrim("telefono") = '' AND "email" IS NOT NULL AND btrim("email") <> '';--> statement-breakpoint
UPDATE "usuarios" SET "email" = NULL WHERE "email" IS NOT NULL AND btrim("email") = '' AND "telefono" IS NOT NULL AND btrim("telefono") <> '';
