import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateOrganizationTypeDto } from './create-organization-type.dto';

export class UpdateOrganizationTypeDto extends PartialType(OmitType(CreateOrganizationTypeDto, ['typeCode'] as const)) {}
