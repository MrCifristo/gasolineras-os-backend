import { Module } from "@nestjs/common";
import { SaldosController } from "./saldos.controller";
import { SaldosService } from "./saldos.service";

@Module({
  controllers: [SaldosController],
  providers: [SaldosService],
  exports: [SaldosService],
})
export class SaldosModule {}
