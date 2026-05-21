import { Module } from '@nestjs/common';
import { PreciosCombustibleController } from './precios-combustible.controller';
import { PreciosCombustibleService } from './precios-combustible.service';

@Module({
  controllers: [PreciosCombustibleController],
  providers: [PreciosCombustibleService],
  exports: [PreciosCombustibleService],
})
export class PreciosCombustibleModule {}
