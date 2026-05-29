import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";
import { RolesGuard } from "./roles.guard";

@Module({
  controllers: [AuthController],
  providers: [AuthGuard, RolesGuard, AuthService],
  exports: [AuthGuard, RolesGuard],
})
export class AuthModule {}
