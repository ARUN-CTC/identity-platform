import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class AssignRoleDto {
  @ApiProperty()
  @IsUUID()
  roleId: string;

  @ApiPropertyOptional({
    description: 'Scopes the grant to one organization; omit for a tenant-wide grant.',
  })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}
