import { Body, Controller, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly service: AuthService) {}

  @Post("login")
  @ApiOperation({ summary: "Iniciar sesión" })
  login(@Body() dto: LoginDto) {
    return this.service.login(dto);
  }
}
