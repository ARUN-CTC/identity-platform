import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class GrantPlatformPermissionDto {
  @ApiProperty()
  @IsString()
  permissionCode: string;
}
