import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CreateEntitlementDto {
  @ApiProperty({ description: 'The Product this Tenant is being entitled to use.' })
  @IsUUID()
  productId: string;
}
