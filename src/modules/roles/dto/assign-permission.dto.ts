import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AssignPermissionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  permissionId: string;
}
