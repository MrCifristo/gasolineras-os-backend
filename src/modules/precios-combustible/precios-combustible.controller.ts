import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { Auth } from "../../auth/roles.decorator";
import { PreciosCombustibleService } from "./precios-combustible.service";
import { CreatePrecioDto } from "./dto/create-precio.dto";
import { UpdatePrecioDto } from "./dto/update-precio.dto";

@ApiTags("precios-combustible")
@ApiBearerAuth("JWT")
@Controller("precios-combustible")
export class PreciosCombustibleController {
  constructor(private readonly service: PreciosCombustibleService) {}

  @Get()
  @Auth("admin", "operario")
  @ApiOperation({
    summary: "Listar precios, filtrable por gasolinera_id y fecha",
  })
  @ApiQuery({ name: "gasolinera_id", required: false })
  @ApiQuery({ name: "fecha", required: false, example: "2026-05-21" })
  findAll(
    @Query("gasolinera_id") gasolineraId?: string,
    @Query("fecha") fecha?: string,
  ) {
    return this.service.findAll(gasolineraId, fecha);
  }

  @Get("hoy")
  @Auth("admin", "operario")
  @ApiOperation({
    summary: "Precios de hoy para la gasolinera del operario autenticado",
  })
  findHoy(@Request() req: any) {
    return this.service.findHoy(req.user.gasolinera_id);
  }

  @Post()
  @Auth("admin")
  @ApiOperation({ summary: "Registrar precio del día" })
  create(@Body() dto: CreatePrecioDto) {
    return this.service.create(dto);
  }

  @Patch(":id")
  @Auth("admin")
  @ApiOperation({ summary: "Corregir precio" })
  update(@Param("id") id: string, @Body() dto: UpdatePrecioDto) {
    return this.service.update(id, dto);
  }
}
