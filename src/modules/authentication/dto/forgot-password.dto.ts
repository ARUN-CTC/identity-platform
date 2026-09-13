import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty()
  @IsString()
  tenantCode: string;

  @ApiProperty()
  @IsEmail()
  email: string;
}
