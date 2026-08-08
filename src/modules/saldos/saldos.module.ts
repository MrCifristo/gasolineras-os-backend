import { Module } from "@nestjs/common";
import { SaldosController } from "./saldos.controller";
import { SaldosService } from "./saldos.service";
import { SaldosPdfService } from "./pdf/saldos-pdf.service";

@Module({
  controllers: [SaldosController],
  providers: [SaldosService, SaldosPdfService],
  exports: [SaldosService],
})
export class SaldosModule {}
