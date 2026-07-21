import { Global, Module } from "@nestjs/common";
import { R2StorageService } from "./r2-storage.service";
import { StorageService } from "./storage.service";

/**
 * Global para que despachos (y quien lea firmas) inyecte StorageService sin
 * importar el módulo. El token es la clase abstracta StorageService; los tests
 * lo sobreescriben con el fake en memoria vía overrideProvider.
 */
@Global()
@Module({
  providers: [{ provide: StorageService, useClass: R2StorageService }],
  exports: [StorageService],
})
export class StorageModule {}
